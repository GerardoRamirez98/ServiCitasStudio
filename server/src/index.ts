import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import { customAlphabet } from 'nanoid';
import path from 'path';
import { requireAuth, signToken } from './auth';
import { getPool, sql } from './db';
import type { UserRole } from './types';

const app = express();
const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 20);
const codeId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);
const allowedRoles: UserRole[] = ['client', 'employee', 'receptionist', 'manager', 'admin', 'owner'];
const adminRoles: UserRole[] = ['owner', 'admin', 'manager'];
const schedulerRoles: UserRole[] = ['owner', 'admin', 'manager', 'receptionist'];
const staffRoles: UserRole[] = ['owner', 'admin', 'manager', 'receptionist', 'employee'];
const appointmentStatuses = ['pending', 'confirmed', 'waiting', 'in_service', 'completed', 'lost', 'cancelled'];
const paymentStatuses = ['not_required', 'pending', 'paid', 'offline', 'refunded'];
const paymentMethods = ['none', 'card', 'cash', 'transfer', 'mercado_pago', 'spei', 'oxxo'];
const paymentProviders = ['none', 'mercado_pago'];
const promotionDiscountTypes = ['percent', 'fixed'];
const employeeBlockTypes = ['vacation', 'sick_leave', 'meal', 'permission', 'custom_schedule'];
const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || 'uploads');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});
const imageExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadsRoot));

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : String(value ?? '');
}

function publicCode(name: string) {
  const prefix = name.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'SERV';
  return `${prefix}${codeId().slice(0, 4)}`;
}

function isRole(value: unknown): value is UserRole {
  return allowedRoles.includes(value as UserRole);
}

function normalizeCode(value: unknown) {
  return String(value ?? '').replace(/[^a-z0-9]/gi, '').trim().toUpperCase();
}

function stringValue(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseTimeToMinutes(value: unknown) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function appointmentDuration(row: Record<string, unknown>) {
  return numberValue(row.Duration, 60) || 60;
}

function parseJsonObject(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function weekdayFromDate(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function employeeScheduleAllowsSlot(employee: Record<string, unknown>, settings: Record<string, unknown> | undefined, date: string, startTime: string, duration: number) {
  const start = parseTimeToMinutes(startTime);
  if (start === null) return false;
  const overrides = parseJsonObject(employee.ScheduleOverridesJson);
  const override = parseJsonObject(overrides[String(weekdayFromDate(date))]);
  if (override.enabled === false) return false;

  const businessStart = parseTimeToMinutes(override.start ?? settings?.BusinessStart ?? '09:00');
  const businessEnd = parseTimeToMinutes(override.end ?? settings?.BusinessEnd ?? '18:00');
  if (businessStart === null || businessEnd === null || start < businessStart || start + duration > businessEnd) return false;

  const businessBreakEnabled = Boolean(settings?.BreakEnabled);
  const hasOverrideBreak = parseTimeToMinutes(override.breakStart) !== null && parseTimeToMinutes(override.breakEnd) !== null;
  if (!businessBreakEnabled && !hasOverrideBreak) return true;
  const breakStart = parseTimeToMinutes(override.breakStart ?? settings?.BreakStart);
  const breakEnd = parseTimeToMinutes(override.breakEnd ?? settings?.BreakEnd);
  return breakStart === null || breakEnd === null || breakStart >= breakEnd || start >= breakEnd || start + duration <= breakStart;
}

function emptyPaymentSummary() {
  return {
    totalRevenue: 0,
    deposits: 0,
    pendingPayments: 0,
    completedPayments: 0,
    cash: 0,
    transfer: 0,
    mercadoPago: 0,
    spei: 0,
    oxxo: 0,
    fees: 0,
    byEmployee: {} as Record<string, number>,
    byService: {} as Record<string, number>,
  };
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function userRowToProfile(row: Record<string, unknown>) {
  return {
    id: String(row.Id),
    name: String(row.Name),
    email: String(row.Email),
    role: allowedRoles.includes(row.Role as UserRole) ? (row.Role as UserRole) : 'client',
    organizationId: String(row.OrganizationId),
    organizationName: String(row.OrganizationName),
    employeeId: row.EmployeeId ? String(row.EmployeeId) : undefined,
    clientOrganizationId: row.ClientOrganizationId ? String(row.ClientOrganizationId) : undefined,
    clientOrganizationName: row.ClientOrganizationName ? String(row.ClientOrganizationName) : undefined,
  };
}

function organizationLocation(addressJson: unknown) {
  const address = parseJsonObject(addressJson);
  return {
    city: stringValue(address.city),
    state: stringValue(address.state),
  };
}

app.get('/health', async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query('SELECT @@SERVERNAME AS serverName, DB_NAME() AS databaseName, SYSDATETIME() AS checkedAt');
  res.json({ ok: true, ...result.recordset[0] });
});

function assertSameOrg(req: express.Request, res: express.Response) {
  if (req.user?.organizationId !== req.params.organizationId) {
    res.status(403).json({ message: 'No tienes acceso a este negocio.' });
    return false;
  }
  return true;
}

function assertOrgAdmin(req: express.Request, res: express.Response) {
  if (!assertSameOrg(req, res)) return false;
  if (!req.user?.role || !adminRoles.includes(req.user.role)) {
    res.status(403).json({ message: 'No tienes permisos para modificar este negocio.' });
    return false;
  }
  return true;
}

function assertOrgStaff(req: express.Request, res: express.Response) {
  if (!assertSameOrg(req, res)) return false;
  if (!req.user?.role || !staffRoles.includes(req.user.role)) {
    res.status(403).json({ message: 'No tienes permisos para operar esta seccion.' });
    return false;
  }
  return true;
}

function assertOrgScheduler(req: express.Request, res: express.Response) {
  if (!assertSameOrg(req, res)) return false;
  if (!req.user?.role || !schedulerRoles.includes(req.user.role)) {
    res.status(403).json({ message: 'No tienes permisos para operar la agenda completa.' });
    return false;
  }
  return true;
}

function isStaff(req: express.Request) {
  return Boolean(req.user?.role && staffRoles.includes(req.user.role));
}

function isScheduler(req: express.Request) {
  return Boolean(req.user?.role && schedulerRoles.includes(req.user.role));
}

function localUploadPathFromUrl(value: unknown) {
  const logoUrl = String(value ?? '');
  if (!logoUrl.startsWith('/uploads/')) return null;
  const relativePath = logoUrl.replace(/^\/uploads\//, '').replace(/[\\/]+/g, path.sep);
  const resolvedPath = path.resolve(uploadsRoot, relativePath);
  return resolvedPath.startsWith(uploadsRoot) ? resolvedPath : null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'categoria';
}

async function ensureDatabaseShape() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_Email')
      CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(Email);
    IF COL_LENGTH('dbo.Users', 'ClientOrganizationId') IS NULL
      ALTER TABLE dbo.Users ADD ClientOrganizationId nvarchar(128) NULL;
    IF COL_LENGTH('dbo.Users', 'ClientOrganizationName') IS NULL
      ALTER TABLE dbo.Users ADD ClientOrganizationName nvarchar(200) NULL;

    IF COL_LENGTH('dbo.Appointments', 'RequestedDepositPaymentMethod') IS NULL
      ALTER TABLE dbo.Appointments ADD RequestedDepositPaymentMethod nvarchar(40) NULL;
    IF COL_LENGTH('dbo.Appointments', 'SpecialPrice') IS NULL
      ALTER TABLE dbo.Appointments ADD SpecialPrice decimal(12, 2) NULL;
    IF COL_LENGTH('dbo.Appointments', 'DelayNotice') IS NULL
      ALTER TABLE dbo.Appointments ADD DelayNotice nvarchar(500) NULL;
    IF COL_LENGTH('dbo.Appointments', 'DelayMinutes') IS NULL
      ALTER TABLE dbo.Appointments ADD DelayMinutes int NULL;
    IF COL_LENGTH('dbo.Appointments', 'CancelledAt') IS NULL
      ALTER TABLE dbo.Appointments ADD CancelledAt datetime2 NULL;
    IF COL_LENGTH('dbo.Appointments', 'CancelledBy') IS NULL
      ALTER TABLE dbo.Appointments ADD CancelledBy nvarchar(40) NULL;
    IF COL_LENGTH('dbo.Appointments', 'CancellationReason') IS NULL
      ALTER TABLE dbo.Appointments ADD CancellationReason nvarchar(500) NULL;
    IF COL_LENGTH('dbo.Appointments', 'CancellationTiming') IS NULL
      ALTER TABLE dbo.Appointments ADD CancellationTiming nvarchar(40) NULL;
    IF COL_LENGTH('dbo.Appointments', 'RefundStatus') IS NULL
      ALTER TABLE dbo.Appointments ADD RefundStatus nvarchar(40) NULL;
    IF COL_LENGTH('dbo.Appointments', 'ServiceRightForfeited') IS NULL
      ALTER TABLE dbo.Appointments ADD ServiceRightForfeited bit NULL;
    IF COL_LENGTH('dbo.Appointments', 'ServicePaymentMethod') IS NULL
      ALTER TABLE dbo.Appointments ADD ServicePaymentMethod nvarchar(40) NULL;
    IF COL_LENGTH('dbo.Appointments', 'ServicePaymentStatus') IS NULL
      ALTER TABLE dbo.Appointments ADD ServicePaymentStatus nvarchar(40) NULL;
    IF COL_LENGTH('dbo.Appointments', 'ServicePaidAt') IS NULL
      ALTER TABLE dbo.Appointments ADD ServicePaidAt datetime2 NULL;
    IF COL_LENGTH('dbo.Services', 'CategoryId') IS NULL
      ALTER TABLE dbo.Services ADD CategoryId nvarchar(128) NULL;
    IF COL_LENGTH('dbo.Services', 'EmployeeDurationsJson') IS NULL
      ALTER TABLE dbo.Services ADD EmployeeDurationsJson nvarchar(max) NULL;
    IF COL_LENGTH('dbo.Employees', 'SpecialtiesJson') IS NULL
      ALTER TABLE dbo.Employees ADD SpecialtiesJson nvarchar(max) NULL;
    IF COL_LENGTH('dbo.Employees', 'ServiceDurationsJson') IS NULL
      ALTER TABLE dbo.Employees ADD ServiceDurationsJson nvarchar(max) NULL;
    IF COL_LENGTH('dbo.Employees', 'ScheduleOverridesJson') IS NULL
      ALTER TABLE dbo.Employees ADD ScheduleOverridesJson nvarchar(max) NULL;
    IF COL_LENGTH('dbo.Announcements', 'Audience') IS NULL
      ALTER TABLE dbo.Announcements ADD Audience nvarchar(40) NOT NULL CONSTRAINT DF_Announcements_Audience DEFAULT 'all';
    IF COL_LENGTH('dbo.BusinessSettings', 'LatePolicyEnabled') IS NULL
      ALTER TABLE dbo.BusinessSettings ADD LatePolicyEnabled bit NOT NULL CONSTRAINT DF_BusinessSettings_LatePolicyEnabled DEFAULT 0;

    IF OBJECT_ID('dbo.ServiceCategories', 'U') IS NULL
      CREATE TABLE dbo.ServiceCategories (
        Id nvarchar(128) NOT NULL CONSTRAINT PK_ServiceCategories PRIMARY KEY,
        OrganizationId nvarchar(128) NOT NULL,
        Name nvarchar(160) NOT NULL,
        Slug nvarchar(180) NOT NULL,
        Active bit NOT NULL CONSTRAINT DF_ServiceCategories_Active DEFAULT 1,
        SortOrder int NOT NULL CONSTRAINT DF_ServiceCategories_SortOrder DEFAULT 0,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ServiceCategories_CreatedAt DEFAULT sysutcdatetime(),
        UpdatedAt datetime2 NOT NULL CONSTRAINT DF_ServiceCategories_UpdatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT FK_ServiceCategories_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
      );
    IF OBJECT_ID('dbo.PortfolioItems', 'U') IS NULL
      CREATE TABLE dbo.PortfolioItems (
        Id nvarchar(128) NOT NULL CONSTRAINT PK_PortfolioItems PRIMARY KEY,
        OrganizationId nvarchar(128) NOT NULL,
        Title nvarchar(200) NOT NULL,
        Description nvarchar(500) NULL,
        CategoryId nvarchar(128) NULL,
        EmployeeId nvarchar(128) NULL,
        ImageUrl nvarchar(1000) NOT NULL,
        Active bit NOT NULL CONSTRAINT DF_PortfolioItems_Active DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_PortfolioItems_CreatedAt DEFAULT sysutcdatetime(),
        UpdatedAt datetime2 NOT NULL CONSTRAINT DF_PortfolioItems_UpdatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT FK_PortfolioItems_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
      );
    IF OBJECT_ID('dbo.Promotions', 'U') IS NULL
      CREATE TABLE dbo.Promotions (
        Id nvarchar(128) NOT NULL CONSTRAINT PK_Promotions PRIMARY KEY,
        OrganizationId nvarchar(128) NOT NULL,
        Title nvarchar(200) NOT NULL,
        Description nvarchar(500) NULL,
        Active bit NOT NULL CONSTRAINT DF_Promotions_Active DEFAULT 1,
        StartsAt date NOT NULL,
        EndsAt date NOT NULL,
        DiscountType nvarchar(40) NOT NULL,
        DiscountValue decimal(12, 2) NOT NULL,
        ServiceIdsJson nvarchar(max) NOT NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Promotions_CreatedAt DEFAULT sysutcdatetime(),
        UpdatedAt datetime2 NOT NULL CONSTRAINT DF_Promotions_UpdatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT FK_Promotions_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
      );
    IF OBJECT_ID('dbo.ClientHistories', 'U') IS NULL
      CREATE TABLE dbo.ClientHistories (
        OrganizationId nvarchar(128) NOT NULL,
        ClientId nvarchar(128) NOT NULL,
        ClientName nvarchar(200) NOT NULL,
        TotalAppointments int NOT NULL CONSTRAINT DF_ClientHistories_TotalAppointments DEFAULT 0,
        Cancellations int NOT NULL CONSTRAINT DF_ClientHistories_Cancellations DEFAULT 0,
        NoShows int NOT NULL CONSTRAINT DF_ClientHistories_NoShows DEFAULT 0,
        TotalSpent decimal(12, 2) NOT NULL CONSTRAINT DF_ClientHistories_TotalSpent DEFAULT 0,
        FavoriteServiceIdsJson nvarchar(max) NOT NULL CONSTRAINT DF_ClientHistories_FavoriteServiceIdsJson DEFAULT '[]',
        RewardPoints int NOT NULL CONSTRAINT DF_ClientHistories_RewardPoints DEFAULT 0,
        RewardLevel nvarchar(40) NOT NULL CONSTRAINT DF_ClientHistories_RewardLevel DEFAULT 'bronze',
        LastVisitAt datetime2 NULL,
        Notes nvarchar(max) NULL,
        UpdatedAt datetime2 NOT NULL CONSTRAINT DF_ClientHistories_UpdatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT PK_ClientHistories PRIMARY KEY (OrganizationId, ClientId),
        CONSTRAINT FK_ClientHistories_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
      );
    IF OBJECT_ID('dbo.EmployeeBlocks', 'U') IS NULL
      CREATE TABLE dbo.EmployeeBlocks (
        Id nvarchar(128) NOT NULL CONSTRAINT PK_EmployeeBlocks PRIMARY KEY,
        OrganizationId nvarchar(128) NOT NULL,
        EmployeeId nvarchar(128) NOT NULL,
        Type nvarchar(40) NOT NULL,
        BlockDate date NOT NULL,
        StartsAt time(0) NOT NULL,
        EndsAt time(0) NOT NULL,
        Note nvarchar(500) NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_EmployeeBlocks_CreatedAt DEFAULT sysutcdatetime(),
        UpdatedAt datetime2 NOT NULL CONSTRAINT DF_EmployeeBlocks_UpdatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT FK_EmployeeBlocks_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
      );
    IF OBJECT_ID('dbo.AuditLogs', 'U') IS NULL
      CREATE TABLE dbo.AuditLogs (
        Id nvarchar(128) NOT NULL CONSTRAINT PK_AuditLogs PRIMARY KEY,
        OrganizationId nvarchar(128) NOT NULL,
        ActorId nvarchar(128) NULL,
        ActorName nvarchar(200) NULL,
        Action nvarchar(120) NOT NULL,
        EntityType nvarchar(80) NOT NULL,
        EntityId nvarchar(128) NULL,
        Detail nvarchar(max) NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_AuditLogs_CreatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT FK_AuditLogs_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
      );
    IF OBJECT_ID('dbo.ClientOrganizations', 'U') IS NULL
      CREATE TABLE dbo.ClientOrganizations (
        ClientId nvarchar(128) NOT NULL,
        OrganizationId nvarchar(128) NOT NULL,
        FollowedAt datetime2 NOT NULL CONSTRAINT DF_ClientOrganizations_FollowedAt DEFAULT sysutcdatetime(),
        LastSelectedAt datetime2 NULL,
        CONSTRAINT PK_ClientOrganizations PRIMARY KEY (ClientId, OrganizationId),
        CONSTRAINT FK_ClientOrganizations_Users FOREIGN KEY (ClientId) REFERENCES dbo.Users(Id),
        CONSTRAINT FK_ClientOrganizations_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
      );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ClientOrganizations_OrganizationId')
      CREATE INDEX IX_ClientOrganizations_OrganizationId ON dbo.ClientOrganizations(OrganizationId, FollowedAt DESC);

    INSERT INTO dbo.ClientOrganizations (ClientId, OrganizationId, LastSelectedAt)
    SELECT u.Id, u.OrganizationId, sysutcdatetime()
    FROM dbo.Users u
    WHERE u.Role = 'client'
      AND NOT EXISTS (
        SELECT 1 FROM dbo.ClientOrganizations co
        WHERE co.ClientId = u.Id AND co.OrganizationId = u.OrganizationId
      );
    EXEC('
      UPDATE u
      SET ClientOrganizationId = COALESCE(u.ClientOrganizationId, u.OrganizationId),
        ClientOrganizationName = COALESCE(u.ClientOrganizationName, u.OrganizationName)
      FROM dbo.Users u
      WHERE u.Role = ''client'';
    ');

    UPDATE e
    SET UserId = u.Id, UpdatedAt = sysutcdatetime()
    FROM dbo.Employees e
    INNER JOIN dbo.Users u
      ON u.OrganizationId = e.OrganizationId
      AND u.Email = e.Email
      AND u.Role IN ('owner', 'admin', 'manager', 'receptionist', 'employee')
      AND (u.EmployeeId IS NULL OR u.EmployeeId = e.Id)
    WHERE e.UserId IS NULL
      AND NULLIF(e.Email, '') IS NOT NULL;

    UPDATE u
    SET EmployeeId = e.Id, UpdatedAt = sysutcdatetime()
    FROM dbo.Users u
    INNER JOIN dbo.Employees e ON e.UserId = u.Id
    WHERE u.EmployeeId IS NULL;
  `);
}

async function writeAudit(organizationId: string, req: express.Request, action: string, entityType: string, entityId?: string, detail?: unknown) {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, id())
    .input('organizationId', sql.NVarChar, organizationId)
    .input('actorId', sql.NVarChar, req.user?.id ?? null)
    .input('actorName', sql.NVarChar, req.user?.name ?? null)
    .input('action', sql.NVarChar, action)
    .input('entityType', sql.NVarChar, entityType)
    .input('entityId', sql.NVarChar, entityId ?? null)
    .input('detail', sql.NVarChar, detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail))
    .query('INSERT INTO dbo.AuditLogs (Id, OrganizationId, ActorId, ActorName, Action, EntityType, EntityId, Detail) VALUES (@id, @organizationId, @actorId, @actorName, @action, @entityType, @entityId, @detail)');
}

function rewardLevel(points: number) {
  if (points >= 1000) return 'vip';
  if (points >= 500) return 'gold';
  if (points >= 200) return 'silver';
  return 'bronze';
}

app.post('/auth/register', async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password ?? '');
  const role = isRole(req.body.role) ? req.body.role : 'client';
  const organizationName = String(req.body.organizationName ?? '').trim();
  const organizationCode = normalizeCode(req.body.organizationCode);
  const employeeInviteCode = normalizeCode(req.body.employeeInviteCode);
  const organizationAddress = req.body.organizationAddress;

  if (!name || !email || password.length < 6) {
    res.status(400).json({ message: 'Nombre, correo y contrasena de 6 caracteres son requeridos.' });
    return;
  }
  if (role === 'employee' && !employeeInviteCode) {
    res.status(400).json({ message: 'Falta codigo privado de empleado.' });
    return;
  }
  if (role !== 'owner' && role !== 'admin' && role !== 'employee' && !organizationCode) {
    res.status(400).json({ message: 'Falta codigo del negocio.' });
    return;
  }
  if ((role === 'owner' || role === 'admin') && !organizationCode && !organizationName) {
    res.status(400).json({ message: 'Falta nombre del negocio.' });
    return;
  }

  const pool = await getPool();
  const existing = await pool.request().input('email', sql.NVarChar, email).query('SELECT Id FROM dbo.Users WHERE Email = @email');
  if (existing.recordset.length) {
    res.status(409).json({ message: 'Ese correo ya esta registrado.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = id();
  try {
    let organizationId = '';
    let finalOrganizationName = '';
    let employeeId: string | null = null;

    if ((role === 'owner' || role === 'admin') && !organizationCode) {
      organizationId = id();
      finalOrganizationName = organizationName;
      await pool
        .request()
        .input('id', sql.NVarChar, organizationId)
        .input('name', sql.NVarChar, finalOrganizationName)
        .input('ownerId', sql.NVarChar, userId)
        .input('publicCode', sql.NVarChar, publicCode(finalOrganizationName))
        .input('slug', sql.NVarChar, finalOrganizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
        .input('addressJson', sql.NVarChar, organizationAddress ? JSON.stringify(organizationAddress) : null)
        .query('INSERT INTO dbo.Organizations (Id, Name, OwnerId, PublicCode, Slug, AddressJson) VALUES (@id, @name, @ownerId, @publicCode, @slug, @addressJson)');

      await pool
        .request()
        .input('organizationId', sql.NVarChar, organizationId)
        .query(`
          INSERT INTO dbo.BusinessSettings
            (OrganizationId, RequireDeposit, DepositPercent, ToleranceMinutes, CancellationLimitHours, BusinessStart, BusinessEnd, BreakEnabled, BreakStart, BreakEnd, SlotMinutes, WorkingDaysJson)
          VALUES
            (@organizationId, 0, 30, 10, 24, '09:00', '18:00', 0, '14:00', '15:00', 60, '[1,2,3,4,5,6]');

          INSERT INTO dbo.AppearanceSettings
            (OrganizationId, Preset, DisplayName, Tagline, WelcomeMessage)
          VALUES
            (@organizationId, 'studio', 'ServiCitas', 'Agenda y citas en tiempo real', 'Bienvenido.');
        `);
    } else if (role === 'employee') {
      const employee = await pool
        .request()
        .input('inviteCode', sql.NVarChar, employeeInviteCode)
        .query('SELECT TOP 1 Id, OrganizationId, Name, Email, UserId FROM dbo.Employees WHERE InviteCode = @inviteCode AND Active = 1');
      if (!employee.recordset.length) {
        throw new Error('No encontramos ese codigo privado de empleado.');
      }
      const row = employee.recordset[0];
      if (row.UserId) {
        throw new Error('Ese codigo de empleado ya fue usado.');
      }
      const expectedEmail = normalizeEmail(row.Email);
      if (expectedEmail && expectedEmail !== email) {
        throw new Error('El correo no coincide con la invitacion del empleado.');
      }
      organizationId = String(row.OrganizationId);
      employeeId = String(row.Id);
      const organization = await pool
        .request()
        .input('id', sql.NVarChar, organizationId)
        .query('SELECT Name FROM dbo.Organizations WHERE Id = @id');
      finalOrganizationName = String(organization.recordset[0]?.Name ?? 'Organizacion');
    } else {
      const organization = await pool
        .request()
        .input('publicCode', sql.NVarChar, organizationCode)
        .query('SELECT Id, Name FROM dbo.Organizations WHERE PublicCode = @publicCode');
      if (!organization.recordset.length) {
        throw new Error('No encontramos ese codigo de negocio.');
      }
      organizationId = String(organization.recordset[0].Id);
      finalOrganizationName = String(organization.recordset[0].Name);
    }

    const finalRole = role === 'admin' && !organizationCode ? 'owner' : role;
    await pool
      .request()
      .input('id', sql.NVarChar, userId)
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .input('role', sql.NVarChar, finalRole)
      .input('organizationId', sql.NVarChar, organizationId)
      .input('organizationName', sql.NVarChar, finalOrganizationName)
      .input('employeeId', sql.NVarChar, employeeId)
      .input('clientOrganizationId', sql.NVarChar, finalRole === 'client' ? organizationId : null)
      .input('clientOrganizationName', sql.NVarChar, finalRole === 'client' ? finalOrganizationName : null)
      .query(`
        INSERT INTO dbo.Users (Id, Name, Email, PasswordHash, Role, OrganizationId, OrganizationName, EmployeeId, ClientOrganizationId, ClientOrganizationName)
        VALUES (@id, @name, @email, @passwordHash, @role, @organizationId, @organizationName, @employeeId, @clientOrganizationId, @clientOrganizationName)
      `);

    if (employeeId) {
      await pool
        .request()
        .input('id', sql.NVarChar, employeeId)
        .input('userId', sql.NVarChar, userId)
        .query('UPDATE dbo.Employees SET UserId = @userId, UpdatedAt = sysutcdatetime() WHERE Id = @id');
    }
    if (finalRole === 'client') {
      await pool.request()
        .input('clientId', sql.NVarChar, userId)
        .input('organizationId', sql.NVarChar, organizationId)
        .query('INSERT INTO dbo.ClientOrganizations (ClientId, OrganizationId, LastSelectedAt) VALUES (@clientId, @organizationId, sysutcdatetime())');
    }

    const profile = { id: userId, name, email, role: finalRole, organizationId, organizationName: finalOrganizationName, employeeId: employeeId ?? undefined };
    res.status(201).json({ token: signToken(profile), profile });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'No se pudo registrar.' });
  }
});

app.post('/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password ?? '');
  const pool = await getPool();
  const result = await pool.request().input('email', sql.NVarChar, email).query('SELECT * FROM dbo.Users WHERE Email = @email');
  const row = result.recordset[0];
  if (!row?.PasswordHash || !(await bcrypt.compare(password, row.PasswordHash))) {
    res.status(401).json({ message: 'Correo o contrasena incorrectos.' });
    return;
  }
  const profile = userRowToProfile(row);
  res.json({ token: signToken({ id: profile.id, role: profile.role, organizationId: profile.organizationId }), profile });
});

app.get('/auth/me', requireAuth, async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.NVarChar, req.user?.id).query('SELECT * FROM dbo.Users WHERE Id = @id');
  if (!result.recordset.length) {
    res.status(404).json({ message: 'Usuario no encontrado.' });
    return;
  }
  res.json({ profile: userRowToProfile(result.recordset[0]) });
});

app.get('/clients/organizations', requireAuth, async (req, res) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('clientId', sql.NVarChar, req.user?.id)
    .query(`
      SELECT o.Id, o.Name, o.PublicCode, o.AddressJson, co.LastSelectedAt,
        COALESCE(u.ClientOrganizationId, u.OrganizationId) AS ActiveOrganizationId
      FROM dbo.ClientOrganizations co
      INNER JOIN dbo.Organizations o ON o.Id = co.OrganizationId
      INNER JOIN dbo.Users u ON u.Id = co.ClientId
      WHERE co.ClientId = @clientId
      ORDER BY CASE WHEN o.Id = COALESCE(u.ClientOrganizationId, u.OrganizationId) THEN 0 ELSE 1 END, co.LastSelectedAt DESC, o.Name
    `);
  res.json({
    organizations: result.recordset.map((organization) => ({
      id: String(organization.Id),
      name: String(organization.Name),
      publicCode: organization.PublicCode ? String(organization.PublicCode) : undefined,
      active: String(organization.Id) === String(organization.ActiveOrganizationId),
      followed: true,
      ...organizationLocation(organization.AddressJson),
    })),
  });
});

app.get('/clients/organizations/search', requireAuth, async (req, res) => {
  const query = stringValue(req.query.query);
  const code = normalizeCode(query);
  if (query.length < 2 && code.length < 4) {
    res.json({ organizations: [] });
    return;
  }
  const pool = await getPool();
  const result = await pool.request()
    .input('clientId', sql.NVarChar, req.user?.id)
    .input('query', sql.NVarChar, `%${query}%`)
    .input('code', sql.NVarChar, code)
    .query(`
      SELECT TOP 20 o.Id, o.Name, o.PublicCode, o.AddressJson,
        CASE WHEN co.ClientId IS NULL THEN 0 ELSE 1 END AS Followed,
        COALESCE(u.ClientOrganizationId, u.OrganizationId) AS ActiveOrganizationId
      FROM dbo.Organizations o
      INNER JOIN dbo.Users u ON u.Id = @clientId
      LEFT JOIN dbo.ClientOrganizations co ON co.OrganizationId = o.Id AND co.ClientId = @clientId
      WHERE o.PublicCode = @code OR o.Name LIKE @query OR o.Slug LIKE @query
      ORDER BY CASE WHEN o.PublicCode = @code THEN 0 ELSE 1 END, o.Name
    `);
  res.json({
    organizations: result.recordset.map((organization) => ({
      id: String(organization.Id),
      name: String(organization.Name),
      publicCode: organization.PublicCode ? String(organization.PublicCode) : undefined,
      active: String(organization.Id) === String(organization.ActiveOrganizationId),
      followed: Boolean(organization.Followed),
      ...organizationLocation(organization.AddressJson),
    })),
  });
});

app.get('/clients/appointments', requireAuth, async (req, res) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('clientId', sql.NVarChar, req.user?.id)
    .query(`
      SELECT TOP 100 a.Id, a.OrganizationId, o.Name AS OrganizationName, a.AppointmentDate, a.AppointmentTime, a.Status, a.Total
      FROM dbo.Appointments a
      INNER JOIN dbo.Organizations o ON o.Id = a.OrganizationId
      INNER JOIN dbo.ClientOrganizations co ON co.OrganizationId = a.OrganizationId AND co.ClientId = a.ClientId
      WHERE a.ClientId = @clientId
      ORDER BY a.AppointmentDate DESC, a.AppointmentTime DESC
    `);
  res.json({
    appointments: result.recordset.map((appointment) => ({
      id: String(appointment.Id),
      organizationId: String(appointment.OrganizationId),
      organizationName: String(appointment.OrganizationName),
      date: String(appointment.AppointmentDate).slice(0, 10),
      time: String(appointment.AppointmentTime).slice(0, 5),
      status: enumValue(appointment.Status, appointmentStatuses, 'pending'),
      total: numberValue(appointment.Total, 0),
    })),
  });
});

app.post('/clients/organizations', requireAuth, async (req, res) => {
  const publicCode = normalizeCode(req.body.publicCode);
  if (!publicCode) {
    res.status(400).json({ message: 'Ingresa el codigo publico del negocio.' });
    return;
  }
  const pool = await getPool();
  const organization = await pool.request()
    .input('publicCode', sql.NVarChar, publicCode)
    .query('SELECT TOP 1 Id, Name, PublicCode, AddressJson FROM dbo.Organizations WHERE PublicCode = @publicCode');
  if (!organization.recordset.length) {
    res.status(404).json({ message: 'No encontramos ese negocio.' });
    return;
  }
  const row = organization.recordset[0];
  await pool.request()
    .input('clientId', sql.NVarChar, req.user?.id)
    .input('organizationId', sql.NVarChar, row.Id)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.ClientOrganizations WHERE ClientId = @clientId AND OrganizationId = @organizationId)
        INSERT INTO dbo.ClientOrganizations (ClientId, OrganizationId) VALUES (@clientId, @organizationId);
    `);
  res.status(201).json({
    organization: {
      id: String(row.Id),
      name: String(row.Name),
      publicCode: String(row.PublicCode),
      active: String(row.Id) === req.user?.organizationId,
      followed: true,
      ...organizationLocation(row.AddressJson),
    },
  });
});

app.post('/clients/organizations/:organizationId/select', requireAuth, async (req, res) => {
  const pool = await getPool();
  const organization = await pool.request()
    .input('clientId', sql.NVarChar, req.user?.id)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query(`
      SELECT TOP 1 o.Id, o.Name
      FROM dbo.ClientOrganizations co
      INNER JOIN dbo.Organizations o ON o.Id = co.OrganizationId
      WHERE co.ClientId = @clientId AND co.OrganizationId = @organizationId
    `);
  if (!organization.recordset.length) {
    res.status(404).json({ message: 'Primero sigue ese negocio para abrirlo.' });
    return;
  }
  const row = organization.recordset[0];
  await pool.request()
    .input('clientId', sql.NVarChar, req.user?.id)
    .input('organizationId', sql.NVarChar, row.Id)
    .input('organizationName', sql.NVarChar, row.Name)
    .query(`
      UPDATE dbo.Users
      SET ClientOrganizationId = @organizationId, ClientOrganizationName = @organizationName, UpdatedAt = sysutcdatetime()
      WHERE Id = @clientId;
      UPDATE dbo.ClientOrganizations
      SET LastSelectedAt = sysutcdatetime()
      WHERE ClientId = @clientId AND OrganizationId = @organizationId;
    `);
  const user = await pool.request()
    .input('id', sql.NVarChar, req.user?.id)
    .query('SELECT TOP 1 * FROM dbo.Users WHERE Id = @id');
  const profile = userRowToProfile(user.recordset[0]);
  res.json({ token: signToken({ id: profile.id, name: profile.name, role: profile.role, organizationId: profile.organizationId }), profile });
});

app.get('/organizations/:id/bootstrap', requireAuth, async (req, res) => {
  const clientView = String(req.query.clientView ?? '') === '1';
  const pool = await getPool();
  const clientAccess = clientView && req.user?.id
    ? await pool.request()
      .input('clientId', sql.NVarChar, req.user.id)
      .input('organizationId', sql.NVarChar, req.params.id)
      .query('SELECT TOP 1 OrganizationId FROM dbo.ClientOrganizations WHERE ClientId = @clientId AND OrganizationId = @organizationId')
    : null;
  if (req.user?.organizationId !== req.params.id && !clientAccess?.recordset.length) {
    res.status(403).json({ message: 'No tienes acceso a este negocio.' });
    return;
  }
  const safeClientView = clientView || req.user?.role === 'client';
  const organization = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Organizations WHERE Id = @id');
  const settings = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.BusinessSettings WHERE OrganizationId = @id');
  const appearance = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.AppearanceSettings WHERE OrganizationId = @id');
  const serviceCategories = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.ServiceCategories WHERE OrganizationId = @id ORDER BY SortOrder, Name');
  const services = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Services WHERE OrganizationId = @id ORDER BY Name');
  const employees = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Employees WHERE OrganizationId = @id ORDER BY Name');
  const appointments = safeClientView
    ? await pool.request().input('id', sql.NVarChar, req.params.id).input('clientId', sql.NVarChar, req.user?.id).query('SELECT TOP 250 * FROM dbo.Appointments WHERE OrganizationId = @id AND ClientId = @clientId ORDER BY AppointmentDate DESC, AppointmentTime DESC')
    : req.user?.role === 'employee'
      ? await pool.request().input('id', sql.NVarChar, req.params.id).input('userId', sql.NVarChar, req.user.id).query(`
        SELECT TOP 250 a.*
        FROM dbo.Appointments a
        INNER JOIN dbo.Employees e ON e.Id = a.EmployeeId AND e.OrganizationId = a.OrganizationId
        WHERE a.OrganizationId = @id AND e.UserId = @userId
        ORDER BY a.AppointmentDate DESC, a.AppointmentTime DESC
      `)
      : await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT TOP 250 * FROM dbo.Appointments WHERE OrganizationId = @id ORDER BY AppointmentDate DESC, AppointmentTime DESC');
  const dayNotes = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.DayNotes WHERE OrganizationId = @id ORDER BY NoteDate');
  const announcements = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Announcements WHERE OrganizationId = @id ORDER BY Title');
  const portfolioItems = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.PortfolioItems WHERE OrganizationId = @id ORDER BY CreatedAt DESC');
  const promotions = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Promotions WHERE OrganizationId = @id ORDER BY StartsAt DESC, Title');
  const clientHistories = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT TOP 500 * FROM dbo.ClientHistories WHERE OrganizationId = @id ORDER BY LastVisitAt DESC, TotalSpent DESC');
  const employeeBlocks = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.EmployeeBlocks WHERE OrganizationId = @id ORDER BY BlockDate DESC, StartsAt');
  const auditLogs = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT TOP 200 * FROM dbo.AuditLogs WHERE OrganizationId = @id ORDER BY CreatedAt DESC');

  res.json({
    organization: organization.recordset[0] ?? null,
    settings: settings.recordset[0] ?? null,
    appearance: appearance.recordset[0] ?? null,
    serviceCategories: serviceCategories.recordset,
    services: services.recordset,
    employees: employees.recordset,
    appointments: appointments.recordset,
    dayNotes: dayNotes.recordset,
    announcements: safeClientView ? announcements.recordset.filter((announcement) => ['clients', 'all'].includes(String(announcement.Audience ?? 'all'))) : announcements.recordset,
    portfolioItems: portfolioItems.recordset,
    promotions: promotions.recordset,
    clientHistories: !safeClientView && isStaff(req) ? clientHistories.recordset : [],
    employeeBlocks: !safeClientView && isStaff(req) ? employeeBlocks.recordset : [],
    auditLogs: !safeClientView && req.user?.role && adminRoles.includes(req.user.role) ? auditLogs.recordset : [],
  });
});

app.get('/organizations/:organizationId/appointments', requireAuth, async (req, res) => {
  if (!assertOrgStaff(req, res)) return;
  const page = Math.max(1, Math.floor(numberValue(req.query.page, 1)));
  const pageSize = Math.min(200, Math.max(10, Math.floor(numberValue(req.query.pageSize, 50))));
  const offset = (page - 1) * pageSize;
  const pool = await getPool();
  const result = await pool.request()
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('userId', sql.NVarChar, req.user?.id)
    .input('role', sql.NVarChar, req.user?.role)
    .input('offset', sql.Int, offset)
    .input('pageSize', sql.Int, pageSize)
    .query(`
      SELECT *, COUNT(*) OVER() AS TotalCount
      FROM dbo.Appointments
      WHERE OrganizationId = @organizationId
        AND (
          @userId IS NULL
          OR @role <> 'employee'
          OR EmployeeId IN (SELECT Id FROM dbo.Employees WHERE UserId = @userId AND OrganizationId = @organizationId)
        )
      ORDER BY AppointmentDate DESC, AppointmentTime DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);
  res.json({
    items: result.recordset,
    page,
    pageSize,
    total: Number(result.recordset[0]?.TotalCount ?? 0),
  });
});

app.get('/organizations/:organizationId/reports/finance', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const from = stringValue(req.query.from);
  const to = stringValue(req.query.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ message: 'Rango invalido. Usa fechas AAAA-MM-DD.' });
    return;
  }

  const pool = await getPool();
  const result = await pool
    .request()
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('from', sql.Date, from)
    .input('to', sql.Date, to)
    .query(`
      SELECT
        a.*,
        e.Name AS EmployeeName
      FROM dbo.Appointments a
      LEFT JOIN dbo.Employees e ON e.Id = a.EmployeeId
      WHERE a.OrganizationId = @organizationId
        AND a.AppointmentDate >= @from
        AND a.AppointmentDate <= @to
      ORDER BY a.AppointmentDate, a.AppointmentTime
    `);
  const services = await pool
    .request()
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query('SELECT Id, Name FROM dbo.Services WHERE OrganizationId = @organizationId');
  const serviceMap = new Map(services.recordset.map((service) => [String(service.Id), String(service.Name)]));
  const summary = emptyPaymentSummary();

  result.recordset.forEach((appointment) => {
    const total = numberValue(appointment.Total, 0);
    const deposit = numberValue(appointment.Deposit, 0);
    const completed = ['completed'].includes(String(appointment.Status)) || ['paid'].includes(String(appointment.PaymentStatus)) || ['paid'].includes(String(appointment.ServicePaymentStatus));
    const pending = ['pending'].includes(String(appointment.PaymentStatus)) || ['pending'].includes(String(appointment.ServicePaymentStatus));
    const method = String(appointment.ServicePaymentMethod || appointment.PaymentMethod || 'none');
    const employeeKey = String(appointment.EmployeeName || appointment.EmployeeId || 'Sin empleado');
    const serviceIds = parseJsonArray(appointment.ServiceIdsJson).map(String);

    if (completed) {
      summary.totalRevenue += total;
      summary.completedPayments += total;
      summary.byEmployee[employeeKey] = (summary.byEmployee[employeeKey] ?? 0) + total;
    }
    if (pending) summary.pendingPayments += Math.max(0, total - deposit);
    if (String(appointment.PaymentStatus) === 'paid') summary.deposits += deposit;
    if (method === 'cash') summary.cash += total;
    if (method === 'transfer') summary.transfer += total;
    if (method === 'mercado_pago' || String(appointment.PaymentProvider) === 'mercado_pago') summary.mercadoPago += total;
    if (method === 'spei') summary.spei += total;
    if (method === 'oxxo') summary.oxxo += total;

    serviceIds.forEach((serviceId) => {
      const key = serviceMap.get(serviceId) ?? serviceId;
      summary.byService[key] = (summary.byService[key] ?? 0) + (completed ? total / Math.max(1, serviceIds.length) : 0);
    });
  });

  if (String(req.query.format ?? '') === 'csv') {
    const rows: unknown[][] = [
      ['metric', 'value'],
      ['totalRevenue', summary.totalRevenue],
      ['deposits', summary.deposits],
      ['pendingPayments', summary.pendingPayments],
      ['completedPayments', summary.completedPayments],
      ['cash', summary.cash],
      ['transfer', summary.transfer],
      ['mercadoPago', summary.mercadoPago],
      ['spei', summary.spei],
      ['oxxo', summary.oxxo],
      ['fees', summary.fees],
      [],
      ['employee', 'amount'],
      ...Object.entries(summary.byEmployee),
      [],
      ['service', 'amount'],
      ...Object.entries(summary.byService),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="servicitas-finance-${from}-${to}.csv"`);
    res.send(csv(rows));
    return;
  }

  res.json({ from, to, summary });
});

app.put('/organizations/:organizationId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.NVarChar, req.params.organizationId)
    .input('name', sql.NVarChar, String(req.body.name ?? '').trim())
    .input('addressJson', sql.NVarChar, req.body.address ? JSON.stringify(req.body.address) : null)
    .query('UPDATE dbo.Organizations SET Name = COALESCE(NULLIF(@name, \'\'), Name), AddressJson = @addressJson, UpdatedAt = sysutcdatetime() WHERE Id = @id');
  if (req.user?.id) {
    await pool
      .request()
      .input('id', sql.NVarChar, req.user.id)
      .input('name', sql.NVarChar, String(req.body.userName ?? '').trim())
      .input('organizationName', sql.NVarChar, String(req.body.name ?? '').trim())
      .query('UPDATE dbo.Users SET Name = COALESCE(NULLIF(@name, \'\'), Name), OrganizationName = COALESCE(NULLIF(@organizationName, \'\'), OrganizationName), UpdatedAt = sysutcdatetime() WHERE Id = @id');
  }
  res.json({ ok: true });
});

app.put('/organizations/:organizationId/settings/business', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool
    .request()
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('requireDeposit', sql.Bit, Boolean(req.body.requireDeposit))
    .input('depositPercent', sql.Decimal(5, 2), Number(req.body.depositPercent ?? 0))
    .input('latePolicyEnabled', sql.Bit, Boolean(req.body.latePolicyEnabled))
    .input('toleranceMinutes', sql.Int, Number(req.body.toleranceMinutes ?? 0))
    .input('cancellationLimitHours', sql.Int, Number(req.body.cancellationLimitHours ?? 0))
    .input('businessStart', sql.NVarChar, String(req.body.businessStart ?? '09:00'))
    .input('businessEnd', sql.NVarChar, String(req.body.businessEnd ?? '18:00'))
    .input('breakEnabled', sql.Bit, Boolean(req.body.breakEnabled))
    .input('breakStart', sql.NVarChar, String(req.body.breakStart ?? '14:00'))
    .input('breakEnd', sql.NVarChar, String(req.body.breakEnd ?? '15:00'))
    .input('slotMinutes', sql.Int, Number(req.body.slotMinutes ?? 60))
    .input('workingDaysJson', sql.NVarChar, JSON.stringify(req.body.workingDays ?? [1, 2, 3, 4, 5, 6]))
    .query(`
      MERGE dbo.BusinessSettings AS target
      USING (SELECT @organizationId AS OrganizationId) AS source
      ON target.OrganizationId = source.OrganizationId
      WHEN MATCHED THEN UPDATE SET
        RequireDeposit = @requireDeposit, DepositPercent = @depositPercent, LatePolicyEnabled = @latePolicyEnabled, ToleranceMinutes = @toleranceMinutes,
        CancellationLimitHours = @cancellationLimitHours, BusinessStart = @businessStart, BusinessEnd = @businessEnd,
        BreakEnabled = @breakEnabled, BreakStart = @breakStart, BreakEnd = @breakEnd, SlotMinutes = @slotMinutes,
        WorkingDaysJson = @workingDaysJson, UpdatedAt = sysutcdatetime()
      WHEN NOT MATCHED THEN INSERT
        (OrganizationId, RequireDeposit, DepositPercent, LatePolicyEnabled, ToleranceMinutes, CancellationLimitHours, BusinessStart, BusinessEnd, BreakEnabled, BreakStart, BreakEnd, SlotMinutes, WorkingDaysJson)
        VALUES (@organizationId, @requireDeposit, @depositPercent, @latePolicyEnabled, @toleranceMinutes, @cancellationLimitHours, @businessStart, @businessEnd, @breakEnabled, @breakStart, @breakEnd, @slotMinutes, @workingDaysJson);
    `);
  res.json({ ok: true });
});

app.put('/organizations/:organizationId/settings/appearance', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool
    .request()
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('preset', sql.NVarChar, String(req.body.preset ?? 'studio'))
    .input('displayName', sql.NVarChar, String(req.body.displayName ?? 'ServiCitas'))
    .input('tagline', sql.NVarChar, String(req.body.tagline ?? 'Agenda y citas'))
    .input('welcomeMessage', sql.NVarChar, String(req.body.welcomeMessage ?? 'Bienvenido.'))
    .input('logoUrl', sql.NVarChar, String(req.body.logoUrl ?? ''))
    .query(`
      MERGE dbo.AppearanceSettings AS target
      USING (SELECT @organizationId AS OrganizationId) AS source
      ON target.OrganizationId = source.OrganizationId
      WHEN MATCHED THEN UPDATE SET
        Preset = @preset, DisplayName = @displayName, Tagline = @tagline, WelcomeMessage = @welcomeMessage, LogoUrl = @logoUrl, UpdatedAt = sysutcdatetime()
      WHEN NOT MATCHED THEN INSERT (OrganizationId, Preset, DisplayName, Tagline, WelcomeMessage, LogoUrl)
        VALUES (@organizationId, @preset, @displayName, @tagline, @welcomeMessage, @logoUrl);
    `);
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/logo', requireAuth, upload.single('logo'), async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  if (!req.file) {
    res.status(400).json({ message: 'Selecciona una imagen para subir.' });
    return;
  }

  const extension = imageExtensions[req.file.mimetype];
  if (!extension) {
    res.status(400).json({ message: 'El logo debe ser JPG, PNG o WebP.' });
    return;
  }

  const organizationId = paramValue(req.params.organizationId);
  const organizationUploadDir = path.join(uploadsRoot, 'organizations', organizationId);
  const fileName = `logo-${Date.now()}.${extension}`;
  const filePath = path.join(organizationUploadDir, fileName);
  const logoUrl = `/uploads/organizations/${organizationId}/${fileName}`;
  const pool = await getPool();
  const current = await pool
    .request()
    .input('organizationId', sql.NVarChar, organizationId)
    .query('SELECT LogoUrl FROM dbo.AppearanceSettings WHERE OrganizationId = @organizationId');

  await fs.mkdir(organizationUploadDir, { recursive: true });
  await fs.writeFile(filePath, req.file.buffer);

  await pool
    .request()
    .input('organizationId', sql.NVarChar, organizationId)
    .input('logoUrl', sql.NVarChar, logoUrl)
    .query(`
      MERGE dbo.AppearanceSettings AS target
      USING (SELECT @organizationId AS OrganizationId) AS source
      ON target.OrganizationId = source.OrganizationId
      WHEN MATCHED THEN UPDATE SET LogoUrl = @logoUrl, UpdatedAt = sysutcdatetime()
      WHEN NOT MATCHED THEN INSERT (OrganizationId, Preset, DisplayName, Tagline, WelcomeMessage, LogoUrl)
        VALUES (@organizationId, 'studio', 'ServiCitas', 'Agenda y citas', 'Bienvenido.', @logoUrl);
    `);

  const previousPath = localUploadPathFromUrl(current.recordset[0]?.LogoUrl);
  if (previousPath && previousPath !== filePath) {
    await fs.rm(previousPath, { force: true }).catch(() => undefined);
  }

  res.status(201).json({ logoUrl });
});

app.post('/organizations/:organizationId/portfolio/image', requireAuth, upload.single('image'), async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  if (!req.file) {
    res.status(400).json({ message: 'Selecciona una imagen para subir.' });
    return;
  }

  const extension = imageExtensions[req.file.mimetype];
  if (!extension) {
    res.status(400).json({ message: 'La imagen debe ser JPG, PNG o WebP.' });
    return;
  }

  const organizationId = paramValue(req.params.organizationId);
  const organizationUploadDir = path.join(uploadsRoot, 'organizations', organizationId, 'portfolio');
  const fileName = `work-${Date.now()}-${id().slice(0, 6)}.${extension}`;
  const filePath = path.join(organizationUploadDir, fileName);
  const imageUrl = `/uploads/organizations/${organizationId}/portfolio/${fileName}`;

  await fs.mkdir(organizationUploadDir, { recursive: true });
  await fs.writeFile(filePath, req.file.buffer);

  res.status(201).json({ imageUrl });
});

app.post('/organizations/:organizationId/portfolio', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const title = stringValue(req.body.title);
  const imageUrl = stringValue(req.body.imageUrl);
  if (!title || !imageUrl) {
    res.status(400).json({ message: 'Titulo e imagen son requeridos.' });
    return;
  }
  const portfolioId = id();
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, portfolioId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('title', sql.NVarChar, title)
    .input('description', sql.NVarChar, stringValue(req.body.description))
    .input('categoryId', sql.NVarChar, stringValue(req.body.categoryId))
    .input('employeeId', sql.NVarChar, stringValue(req.body.employeeId))
    .input('imageUrl', sql.NVarChar, imageUrl)
    .input('active', sql.Bit, req.body.active !== false)
    .query(`
      INSERT INTO dbo.PortfolioItems (Id, OrganizationId, Title, Description, CategoryId, EmployeeId, ImageUrl, Active)
      VALUES (@id, @organizationId, @title, NULLIF(@description, ''), NULLIF(@categoryId, ''), NULLIF(@employeeId, ''), @imageUrl, @active)
    `);
  res.status(201).json({ id: portfolioId });
});

app.put('/organizations/:organizationId/portfolio/:portfolioId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const title = stringValue(req.body.title);
  const imageUrl = stringValue(req.body.imageUrl);
  if (!title || !imageUrl) {
    res.status(400).json({ message: 'Titulo e imagen son requeridos.' });
    return;
  }
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.portfolioId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('title', sql.NVarChar, title)
    .input('description', sql.NVarChar, stringValue(req.body.description))
    .input('categoryId', sql.NVarChar, stringValue(req.body.categoryId))
    .input('employeeId', sql.NVarChar, stringValue(req.body.employeeId))
    .input('imageUrl', sql.NVarChar, imageUrl)
    .input('active', sql.Bit, req.body.active !== false)
    .query(`
      UPDATE dbo.PortfolioItems
      SET Title = @title, Description = NULLIF(@description, ''), CategoryId = NULLIF(@categoryId, ''), EmployeeId = NULLIF(@employeeId, ''),
        ImageUrl = @imageUrl, Active = @active, UpdatedAt = sysutcdatetime()
      WHERE Id = @id AND OrganizationId = @organizationId
    `);
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/portfolio/:portfolioId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  const current = await pool.request()
    .input('id', sql.NVarChar, req.params.portfolioId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query('SELECT ImageUrl FROM dbo.PortfolioItems WHERE Id = @id AND OrganizationId = @organizationId');
  await pool.request()
    .input('id', sql.NVarChar, req.params.portfolioId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query('DELETE FROM dbo.PortfolioItems WHERE Id = @id AND OrganizationId = @organizationId');

  const imagePath = localUploadPathFromUrl(current.recordset[0]?.ImageUrl);
  if (imagePath) {
    await fs.rm(imagePath, { force: true }).catch(() => undefined);
  }
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/services', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const serviceId = id();
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, serviceId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('name', sql.NVarChar, String(req.body.name ?? '').trim())
    .input('price', sql.Decimal(12, 2), Number(req.body.price ?? 0))
    .input('duration', sql.Int, Number(req.body.duration ?? 0))
    .input('active', sql.Bit, Boolean(req.body.active))
    .input('categoryId', sql.NVarChar, stringValue(req.body.categoryId))
    .input('employeeDurationsJson', sql.NVarChar, JSON.stringify(req.body.employeeDurations ?? {}))
    .query('INSERT INTO dbo.Services (Id, OrganizationId, Name, Price, Duration, Active, CategoryId, EmployeeDurationsJson) VALUES (@id, @organizationId, @name, @price, @duration, @active, NULLIF(@categoryId, \'\'), @employeeDurationsJson)');
  res.status(201).json({ id: serviceId });
});

app.put('/organizations/:organizationId/services/:serviceId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.serviceId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('name', sql.NVarChar, String(req.body.name ?? '').trim())
    .input('price', sql.Decimal(12, 2), Number(req.body.price ?? 0))
    .input('duration', sql.Int, Number(req.body.duration ?? 0))
    .input('active', sql.Bit, Boolean(req.body.active))
    .input('categoryId', sql.NVarChar, stringValue(req.body.categoryId))
    .input('employeeDurationsJson', sql.NVarChar, JSON.stringify(req.body.employeeDurations ?? {}))
    .query('UPDATE dbo.Services SET Name = @name, Price = @price, Duration = @duration, Active = @active, CategoryId = NULLIF(@categoryId, \'\'), EmployeeDurationsJson = @employeeDurationsJson, UpdatedAt = sysutcdatetime() WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/services/:serviceId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.serviceId).input('organizationId', sql.NVarChar, req.params.organizationId).query('DELETE FROM dbo.Services WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/service-categories', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const name = stringValue(req.body.name);
  if (!name) {
    res.status(400).json({ message: 'Nombre de categoria requerido.' });
    return;
  }
  const categoryId = id();
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, categoryId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('name', sql.NVarChar, name)
    .input('slug', sql.NVarChar, slugify(name))
    .input('active', sql.Bit, req.body.active !== false)
    .input('sortOrder', sql.Int, numberValue(req.body.sortOrder, 0))
    .query('INSERT INTO dbo.ServiceCategories (Id, OrganizationId, Name, Slug, Active, SortOrder) VALUES (@id, @organizationId, @name, @slug, @active, @sortOrder)');
  res.status(201).json({ id: categoryId });
});

app.put('/organizations/:organizationId/service-categories/:categoryId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const name = stringValue(req.body.name);
  if (!name) {
    res.status(400).json({ message: 'Nombre de categoria requerido.' });
    return;
  }
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.categoryId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('name', sql.NVarChar, name)
    .input('slug', sql.NVarChar, slugify(name))
    .input('active', sql.Bit, req.body.active !== false)
    .input('sortOrder', sql.Int, numberValue(req.body.sortOrder, 0))
    .query('UPDATE dbo.ServiceCategories SET Name = @name, Slug = @slug, Active = @active, SortOrder = @sortOrder, UpdatedAt = sysutcdatetime() WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/service-categories/:categoryId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.categoryId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query('UPDATE dbo.Services SET CategoryId = NULL WHERE CategoryId = @id AND OrganizationId = @organizationId; DELETE FROM dbo.ServiceCategories WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/promotions', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const title = stringValue(req.body.title);
  const startsAt = stringValue(req.body.startsAt);
  const endsAt = stringValue(req.body.endsAt);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
    res.status(400).json({ message: 'Titulo y rango de fechas son requeridos.' });
    return;
  }
  const promotionId = id();
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, promotionId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('title', sql.NVarChar, title)
    .input('description', sql.NVarChar, stringValue(req.body.description))
    .input('active', sql.Bit, req.body.active !== false)
    .input('startsAt', sql.Date, startsAt)
    .input('endsAt', sql.Date, endsAt)
    .input('discountType', sql.NVarChar, enumValue(req.body.discountType, promotionDiscountTypes, 'percent'))
    .input('discountValue', sql.Decimal(12, 2), numberValue(req.body.discountValue, 0))
    .input('serviceIdsJson', sql.NVarChar, JSON.stringify(parseJsonArray(req.body.serviceIds).map(String).filter(Boolean)))
    .query(`
      INSERT INTO dbo.Promotions (Id, OrganizationId, Title, Description, Active, StartsAt, EndsAt, DiscountType, DiscountValue, ServiceIdsJson)
      VALUES (@id, @organizationId, @title, NULLIF(@description, ''), @active, @startsAt, @endsAt, @discountType, @discountValue, @serviceIdsJson)
    `);
  await writeAudit(paramValue(req.params.organizationId), req, 'create', 'promotion', promotionId, { title });
  res.status(201).json({ id: promotionId });
});

app.put('/organizations/:organizationId/promotions/:promotionId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const title = stringValue(req.body.title);
  const startsAt = stringValue(req.body.startsAt);
  const endsAt = stringValue(req.body.endsAt);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
    res.status(400).json({ message: 'Titulo y rango de fechas son requeridos.' });
    return;
  }
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.promotionId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('title', sql.NVarChar, title)
    .input('description', sql.NVarChar, stringValue(req.body.description))
    .input('active', sql.Bit, req.body.active !== false)
    .input('startsAt', sql.Date, startsAt)
    .input('endsAt', sql.Date, endsAt)
    .input('discountType', sql.NVarChar, enumValue(req.body.discountType, promotionDiscountTypes, 'percent'))
    .input('discountValue', sql.Decimal(12, 2), numberValue(req.body.discountValue, 0))
    .input('serviceIdsJson', sql.NVarChar, JSON.stringify(parseJsonArray(req.body.serviceIds).map(String).filter(Boolean)))
    .query(`
      UPDATE dbo.Promotions
      SET Title = @title, Description = NULLIF(@description, ''), Active = @active, StartsAt = @startsAt, EndsAt = @endsAt,
        DiscountType = @discountType, DiscountValue = @discountValue, ServiceIdsJson = @serviceIdsJson, UpdatedAt = sysutcdatetime()
      WHERE Id = @id AND OrganizationId = @organizationId
    `);
  await writeAudit(paramValue(req.params.organizationId), req, 'update', 'promotion', paramValue(req.params.promotionId), { title });
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/promotions/:promotionId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.promotionId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query('DELETE FROM dbo.Promotions WHERE Id = @id AND OrganizationId = @organizationId');
  await writeAudit(paramValue(req.params.organizationId), req, 'delete', 'promotion', paramValue(req.params.promotionId));
  res.json({ ok: true });
});

app.put('/organizations/:organizationId/client-histories/:clientId', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const pool = await getPool();
  await pool.request()
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('clientId', sql.NVarChar, req.params.clientId)
    .input('clientName', sql.NVarChar, stringValue(req.body.clientName, 'Cliente'))
    .input('notes', sql.NVarChar, stringValue(req.body.notes))
    .query(`
      MERGE dbo.ClientHistories AS target
      USING (SELECT @organizationId AS OrganizationId, @clientId AS ClientId) AS source
      ON target.OrganizationId = source.OrganizationId AND target.ClientId = source.ClientId
      WHEN MATCHED THEN UPDATE SET Notes = @notes, ClientName = COALESCE(NULLIF(@clientName, ''), ClientName), UpdatedAt = sysutcdatetime()
      WHEN NOT MATCHED THEN INSERT (OrganizationId, ClientId, ClientName, Notes)
        VALUES (@organizationId, @clientId, @clientName, @notes);
    `);
  await writeAudit(paramValue(req.params.organizationId), req, 'update_notes', 'client', paramValue(req.params.clientId));
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/employee-blocks', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const blockId = id();
  const date = stringValue(req.body.date);
  const startsAt = stringValue(req.body.startsAt);
  const endsAt = stringValue(req.body.endsAt);
  if (!stringValue(req.body.employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || parseTimeToMinutes(startsAt) === null || parseTimeToMinutes(endsAt) === null) {
    res.status(400).json({ message: 'Empleado, fecha, inicio y fin son requeridos.' });
    return;
  }
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, blockId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('employeeId', sql.NVarChar, stringValue(req.body.employeeId))
    .input('type', sql.NVarChar, enumValue(req.body.type, employeeBlockTypes, 'permission'))
    .input('date', sql.Date, date)
    .input('startsAt', sql.NVarChar, startsAt)
    .input('endsAt', sql.NVarChar, endsAt)
    .input('note', sql.NVarChar, stringValue(req.body.note))
    .query('INSERT INTO dbo.EmployeeBlocks (Id, OrganizationId, EmployeeId, Type, BlockDate, StartsAt, EndsAt, Note) VALUES (@id, @organizationId, @employeeId, @type, @date, @startsAt, @endsAt, NULLIF(@note, \'\'))');
  await writeAudit(paramValue(req.params.organizationId), req, 'create', 'employee_block', blockId);
  res.status(201).json({ id: blockId });
});

app.delete('/organizations/:organizationId/employee-blocks/:blockId', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.blockId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query('DELETE FROM dbo.EmployeeBlocks WHERE Id = @id AND OrganizationId = @organizationId');
  await writeAudit(paramValue(req.params.organizationId), req, 'delete', 'employee_block', paramValue(req.params.blockId));
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/employees', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const employeeId = id();
  const inviteCode = String(req.body.inviteCode ?? codeId());
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, employeeId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('name', sql.NVarChar, String(req.body.name ?? '').trim())
    .input('email', sql.NVarChar, normalizeEmail(req.body.email))
    .input('role', sql.NVarChar, String(req.body.role ?? 'employee'))
    .input('specialtiesJson', sql.NVarChar, JSON.stringify(parseJsonArray(req.body.specialties).map(String).filter(Boolean)))
    .input('active', sql.Bit, Boolean(req.body.active))
    .input('inviteCode', sql.NVarChar, inviteCode)
    .input('compensationMode', sql.NVarChar, String(req.body.compensationMode ?? 'commission'))
    .input('fixedSalary', sql.Decimal(12, 2), Number(req.body.fixedSalary ?? 0))
    .input('commissionPercent', sql.Decimal(5, 2), Number(req.body.commissionPercent ?? 0))
    .input('serviceDurationsJson', sql.NVarChar, JSON.stringify(req.body.serviceDurations ?? {}))
    .input('scheduleOverridesJson', sql.NVarChar, JSON.stringify(req.body.scheduleOverrides ?? {}))
    .query(`
      DECLARE @linkedUserId nvarchar(128) = (
        SELECT TOP 1 Id
        FROM dbo.Users
        WHERE OrganizationId = @organizationId
          AND Email = @email
          AND Role IN ('owner', 'admin', 'manager', 'receptionist', 'employee')
          AND (EmployeeId IS NULL OR EmployeeId = @id)
        ORDER BY CreatedAt
      );

      INSERT INTO dbo.Employees (Id, OrganizationId, UserId, Name, Email, Role, SpecialtiesJson, Active, InviteCode, CompensationMode, FixedSalary, CommissionPercent, ServiceDurationsJson, ScheduleOverridesJson)
      VALUES (@id, @organizationId, @linkedUserId, @name, @email, @role, @specialtiesJson, @active, @inviteCode, @compensationMode, @fixedSalary, @commissionPercent, @serviceDurationsJson, @scheduleOverridesJson);

      IF @linkedUserId IS NOT NULL
        UPDATE dbo.Users
        SET EmployeeId = @id, UpdatedAt = sysutcdatetime()
        WHERE Id = @linkedUserId;
    `);
  res.status(201).json({ id: employeeId, inviteCode });
});

app.put('/organizations/:organizationId/employees/:employeeId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.employeeId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('name', sql.NVarChar, String(req.body.name ?? '').trim())
    .input('email', sql.NVarChar, normalizeEmail(req.body.email))
    .input('role', sql.NVarChar, String(req.body.role ?? 'employee'))
    .input('specialtiesJson', sql.NVarChar, JSON.stringify(parseJsonArray(req.body.specialties).map(String).filter(Boolean)))
    .input('active', sql.Bit, Boolean(req.body.active))
    .input('inviteCode', sql.NVarChar, String(req.body.inviteCode ?? ''))
    .input('compensationMode', sql.NVarChar, String(req.body.compensationMode ?? 'commission'))
    .input('fixedSalary', sql.Decimal(12, 2), Number(req.body.fixedSalary ?? 0))
    .input('commissionPercent', sql.Decimal(5, 2), Number(req.body.commissionPercent ?? 0))
    .input('serviceDurationsJson', sql.NVarChar, JSON.stringify(req.body.serviceDurations ?? {}))
    .input('scheduleOverridesJson', sql.NVarChar, JSON.stringify(req.body.scheduleOverrides ?? {}))
    .query(`
      DECLARE @linkedUserId nvarchar(128) = (
        SELECT TOP 1 Id
        FROM dbo.Users
        WHERE OrganizationId = @organizationId
          AND Email = @email
          AND Role IN ('owner', 'admin', 'manager', 'receptionist', 'employee')
          AND (EmployeeId IS NULL OR EmployeeId = @id)
        ORDER BY CreatedAt
      );

      UPDATE dbo.Employees SET UserId = COALESCE(@linkedUserId, UserId), Name = @name, Email = @email, Role = @role, SpecialtiesJson = @specialtiesJson, Active = @active, InviteCode = @inviteCode,
        CompensationMode = @compensationMode, FixedSalary = @fixedSalary, CommissionPercent = @commissionPercent,
        ServiceDurationsJson = @serviceDurationsJson, ScheduleOverridesJson = @scheduleOverridesJson, UpdatedAt = sysutcdatetime()
      WHERE Id = @id AND OrganizationId = @organizationId;

      IF @linkedUserId IS NOT NULL
        UPDATE dbo.Users
        SET EmployeeId = @id, UpdatedAt = sysutcdatetime()
        WHERE Id = @linkedUserId;
    `);
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/employees/:employeeId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  const appointments = await pool
    .request()
    .input('id', sql.NVarChar, req.params.employeeId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query('SELECT TOP 1 Id FROM dbo.Appointments WHERE EmployeeId = @id AND OrganizationId = @organizationId');
  if (appointments.recordset.length) {
    await pool
      .request()
      .input('id', sql.NVarChar, req.params.employeeId)
      .input('organizationId', sql.NVarChar, req.params.organizationId)
      .query('UPDATE dbo.Employees SET Active = 0, UpdatedAt = sysutcdatetime() WHERE Id = @id AND OrganizationId = @organizationId');
    res.json({ ok: true, deactivated: true });
    return;
  }
  await pool
    .request()
    .input('id', sql.NVarChar, req.params.employeeId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .query('DELETE FROM dbo.Employees WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true, deactivated: false });
});

app.post('/organizations/:organizationId/appointments', requireAuth, async (req, res) => {
  const appointmentId = id();
  const organizationId = paramValue(req.params.organizationId);
  const source = enumValue(req.body.source, ['client', 'manual'] as const, 'client');
  const pool = await getPool();
  if (source === 'manual' && !isStaff(req)) {
    res.status(403).json({ message: 'Solo el personal puede crear citas manuales.' });
    return;
  }
  if (source === 'manual' && !assertSameOrg(req, res)) return;
  if (source === 'client' && String(req.body.clientId ?? req.user?.id) !== req.user?.id) {
    res.status(403).json({ message: 'No puedes agendar a nombre de otro cliente.' });
    return;
  }
  if (source === 'client' && req.user?.organizationId !== organizationId) {
    const followedOrganization = await pool.request()
      .input('clientId', sql.NVarChar, req.user?.id)
      .input('organizationId', sql.NVarChar, organizationId)
      .query('SELECT TOP 1 OrganizationId FROM dbo.ClientOrganizations WHERE ClientId = @clientId AND OrganizationId = @organizationId');
    if (!followedOrganization.recordset.length) {
      res.status(403).json({ message: 'Primero sigue ese negocio para agendar ahi.' });
      return;
    }
  }

  const serviceIds = parseJsonArray(req.body.serviceIds).map(String).filter(Boolean);
  const employeeId = stringValue(req.body.employeeId);
  const date = stringValue(req.body.date);
  const time = stringValue(req.body.time);
  const requestedDuration = Math.max(0, numberValue(req.body.duration, 0));
  if (!serviceIds.length || !employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || parseTimeToMinutes(time) === null) {
    res.status(400).json({ message: 'Servicio, empleado, fecha y hora son requeridos.' });
    return;
  }

  const services = await pool
    .request()
    .input('organizationId', sql.NVarChar, organizationId)
    .query('SELECT Id, Price, Duration, Active, EmployeeDurationsJson FROM dbo.Services WHERE OrganizationId = @organizationId');
  const serviceMap = new Map(services.recordset.map((service) => [String(service.Id), service]));
  const missingService = serviceIds.some((serviceId) => !serviceMap.has(serviceId));
  if (missingService) {
    res.status(400).json({ message: 'Uno o mas servicios no existen en este negocio.' });
    return;
  }
  const duration = requestedDuration || serviceIds.reduce((sum, serviceId) => {
    const service = serviceMap.get(serviceId);
    const durations = (() => {
      try {
        return JSON.parse(String(service?.EmployeeDurationsJson ?? '{}')) as Record<string, number>;
      } catch {
        return {};
      }
    })();
    return sum + numberValue(durations[employeeId], numberValue(service?.Duration, 0));
  }, 0) || 60;
  const subtotal = serviceIds.reduce((sum, serviceId) => sum + numberValue(serviceMap.get(serviceId)?.Price, 0), 0);
  const employee = await pool
    .request()
    .input('id', sql.NVarChar, employeeId)
    .input('organizationId', sql.NVarChar, organizationId)
    .query('SELECT Id, Active, ScheduleOverridesJson FROM dbo.Employees WHERE Id = @id AND OrganizationId = @organizationId');
  if (!employee.recordset.length || !Boolean(employee.recordset[0].Active)) {
    res.status(400).json({ message: 'El empleado seleccionado no esta disponible.' });
    return;
  }
  if (source === 'manual' && req.user?.role === 'employee') {
    const ownEmployee = await pool.request()
      .input('userId', sql.NVarChar, req.user.id)
      .input('organizationId', sql.NVarChar, organizationId)
      .query('SELECT TOP 1 Id FROM dbo.Employees WHERE UserId = @userId AND OrganizationId = @organizationId');
    if (String(ownEmployee.recordset[0]?.Id ?? '') !== employeeId) {
      res.status(403).json({ message: 'Solo puedes crear citas manuales para tu propia agenda.' });
      return;
    }
  }
  const settings = await pool
    .request()
    .input('organizationId', sql.NVarChar, organizationId)
    .query('SELECT TOP 1 * FROM dbo.BusinessSettings WHERE OrganizationId = @organizationId');
  if (!employeeScheduleAllowsSlot(employee.recordset[0], settings.recordset[0], date, time, duration)) {
    res.status(409).json({ message: 'Ese horario queda fuera del horario del empleado.' });
    return;
  }
  const sameDayAppointments = await pool
    .request()
    .input('organizationId', sql.NVarChar, organizationId)
    .input('employeeId', sql.NVarChar, employeeId)
    .input('date', sql.Date, date)
    .query(`
      SELECT Id, AppointmentTime, Duration, Status
      FROM dbo.Appointments
      WHERE OrganizationId = @organizationId AND EmployeeId = @employeeId AND AppointmentDate = @date
        AND Status NOT IN ('completed', 'lost', 'cancelled')
    `);
  const employeeBlocks = await pool
    .request()
    .input('organizationId', sql.NVarChar, organizationId)
    .input('employeeId', sql.NVarChar, employeeId)
    .input('date', sql.Date, date)
    .query('SELECT StartsAt, EndsAt FROM dbo.EmployeeBlocks WHERE OrganizationId = @organizationId AND EmployeeId = @employeeId AND BlockDate = @date');
  const start = parseTimeToMinutes(time);
  const end = (start ?? 0) + duration;
  const hasConflict = sameDayAppointments.recordset.some((appointment) => {
    const appointmentStart = parseTimeToMinutes(appointment.AppointmentTime);
    if (appointmentStart === null) return false;
    const appointmentEnd = appointmentStart + appointmentDuration(appointment);
    return (start ?? 0) < appointmentEnd && end > appointmentStart;
  });
  if (hasConflict) {
    res.status(409).json({ message: 'Ese horario ya esta ocupado para el empleado seleccionado.' });
    return;
  }
  const hasBlockConflict = employeeBlocks.recordset.some((block) => {
    const blockStart = parseTimeToMinutes(block.StartsAt);
    const blockEnd = parseTimeToMinutes(block.EndsAt);
    if (blockStart === null || blockEnd === null) return false;
    return (start ?? 0) < blockEnd && end > blockStart;
  });
  if (hasBlockConflict) {
    res.status(409).json({ message: 'Ese horario esta bloqueado para el empleado seleccionado.' });
    return;
  }

  const deposit = numberValue(req.body.deposit, 0);
  const paymentMethod = enumValue(req.body.paymentMethod, paymentMethods, 'none');
  const requestedDepositPaymentMethod = enumValue(req.body.requestedDepositPaymentMethod, paymentMethods, paymentMethod);
  const promotions = await pool
    .request()
    .input('organizationId', sql.NVarChar, organizationId)
    .input('date', sql.Date, date)
    .query('SELECT * FROM dbo.Promotions WHERE OrganizationId = @organizationId AND Active = 1 AND StartsAt <= @date AND EndsAt >= @date');
  const promoDiscount = promotions.recordset.reduce((best, promotion) => {
    const promoServices = parseJsonArray(promotion.ServiceIdsJson).map(String);
    if (promoServices.length && !serviceIds.some((serviceId) => promoServices.includes(serviceId))) return best;
    const value = numberValue(promotion.DiscountValue, 0);
    const discount = String(promotion.DiscountType) === 'fixed' ? value : Math.round((subtotal * value) / 100);
    return discount > best.amount ? { amount: discount, id: String(promotion.Id), title: String(promotion.Title) } : best;
  }, { amount: 0, id: '', title: '' });
  const requestedSpecialPrice = req.body.specialPrice == null ? null : numberValue(req.body.specialPrice, 0);
  const discountAmount = Math.max(0, numberValue(req.body.discountAmount, promoDiscount.amount));
  const total = requestedSpecialPrice == null ? Math.max(0, subtotal - discountAmount) : requestedSpecialPrice;
  await pool.request()
    .input('id', sql.NVarChar, appointmentId)
    .input('organizationId', sql.NVarChar, organizationId)
    .input('clientId', sql.NVarChar, String(req.body.clientId ?? req.user?.id ?? 'manual'))
    .input('clientName', sql.NVarChar, String(req.body.clientName ?? '').trim())
    .input('date', sql.Date, date)
    .input('time', sql.NVarChar, time)
    .input('endTime', sql.NVarChar, null)
    .input('duration', sql.Int, duration)
    .input('serviceIdsJson', sql.NVarChar, JSON.stringify(serviceIds))
    .input('employeeId', sql.NVarChar, employeeId)
    .input('status', sql.NVarChar, source === 'manual' ? 'confirmed' : 'pending')
    .input('note', sql.NVarChar, String(req.body.note ?? ''))
    .input('deposit', sql.Decimal(12, 2), deposit)
    .input('requiresDeposit', sql.Bit, Boolean(req.body.requiresDeposit))
    .input('depositPercent', sql.Decimal(5, 2), numberValue(req.body.depositPercent, 0))
    .input('paymentStatus', sql.NVarChar, deposit > 0 ? 'pending' : source === 'manual' ? 'offline' : 'not_required')
    .input('paymentMethod', sql.NVarChar, paymentMethod)
    .input('paymentProvider', sql.NVarChar, 'none')
    .input('requestedDepositPaymentMethod', sql.NVarChar, requestedDepositPaymentMethod)
    .input('total', sql.Decimal(12, 2), total)
    .input('subtotal', sql.Decimal(12, 2), subtotal)
    .input('discountAmount', sql.Decimal(12, 2), discountAmount)
    .input('specialPrice', sql.Decimal(12, 2), requestedSpecialPrice)
    .input('discountReason', sql.NVarChar, String(req.body.discountReason ?? promoDiscount.title))
    .input('termsAccepted', sql.Bit, Boolean(req.body.termsAccepted))
    .input('source', sql.NVarChar, source)
    .query(`
      INSERT INTO dbo.Appointments
        (Id, OrganizationId, ClientId, ClientName, AppointmentDate, AppointmentTime, EndTime, Duration, ServiceIdsJson, EmployeeId, Status, Note, Deposit, RequiresDeposit, DepositPercent, PaymentStatus, PaymentMethod, PaymentProvider, RequestedDepositPaymentMethod, Total, Subtotal, DiscountAmount, SpecialPrice, DiscountReason, TermsAccepted, Source)
      VALUES
        (@id, @organizationId, @clientId, @clientName, @date, @time, @endTime, @duration, @serviceIdsJson, @employeeId, @status, @note, @deposit, @requiresDeposit, @depositPercent, @paymentStatus, @paymentMethod, @paymentProvider, @requestedDepositPaymentMethod, @total, @subtotal, @discountAmount, @specialPrice, @discountReason, @termsAccepted, @source)
    `);
  await pool.request()
    .input('organizationId', sql.NVarChar, organizationId)
    .input('clientId', sql.NVarChar, String(req.body.clientId ?? req.user?.id ?? 'manual'))
    .input('clientName', sql.NVarChar, String(req.body.clientName ?? '').trim())
    .query(`
      MERGE dbo.ClientHistories AS target
      USING (SELECT @organizationId AS OrganizationId, @clientId AS ClientId) AS source
      ON target.OrganizationId = source.OrganizationId AND target.ClientId = source.ClientId
      WHEN MATCHED THEN UPDATE SET ClientName = @clientName, TotalAppointments = TotalAppointments + 1, UpdatedAt = sysutcdatetime()
      WHEN NOT MATCHED THEN INSERT (OrganizationId, ClientId, ClientName, TotalAppointments)
        VALUES (@organizationId, @clientId, @clientName, 1);
    `);
  if (source === 'client') {
    await pool.request()
      .input('clientId', sql.NVarChar, req.user?.id)
      .input('organizationId', sql.NVarChar, organizationId)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.ClientOrganizations WHERE ClientId = @clientId AND OrganizationId = @organizationId)
          INSERT INTO dbo.ClientOrganizations (ClientId, OrganizationId, LastSelectedAt) VALUES (@clientId, @organizationId, sysutcdatetime());
      `);
  }
  await writeAudit(organizationId, req, 'create', 'appointment', appointmentId, { clientName: req.body.clientName, date, time });
  res.status(201).json({ appointmentId, employeeId });
});

app.patch('/organizations/:organizationId/appointments/:appointmentId', requireAuth, async (req, res) => {
  const pool = await getPool();
  const current = await pool.request().input('id', sql.NVarChar, req.params.appointmentId).input('organizationId', sql.NVarChar, req.params.organizationId).query('SELECT * FROM dbo.Appointments WHERE Id = @id AND OrganizationId = @organizationId');
  if (!current.recordset.length) {
    res.status(404).json({ message: 'Cita no encontrada.' });
    return;
  }
  const row = current.recordset[0];
  const nextStatus = enumValue(req.body.status, appointmentStatuses, String(row.Status));
  const nextEmployeeId = String(req.body.employeeId ?? row.EmployeeId);
  const nextDate = stringValue(req.body.date ?? String(row.AppointmentDate).slice(0, 10));
  const nextTime = stringValue(req.body.time ?? String(row.AppointmentTime).slice(0, 5));
  const nextServiceIds = req.body.serviceIds ? parseJsonArray(req.body.serviceIds).map(String).filter(Boolean) : parseJsonArray(row.ServiceIdsJson).map(String);
  const nextDuration = req.body.duration == null ? appointmentDuration(row) : numberValue(req.body.duration, appointmentDuration(row));
  const staffInOrganization = req.user?.organizationId === req.params.organizationId && isStaff(req);
  if (!staffInOrganization) {
    const isOwnAppointment = String(row.ClientId) === req.user?.id;
    const clientOnlyCancellation = isOwnAppointment && nextStatus === 'cancelled';
    if (!clientOnlyCancellation) {
      res.status(403).json({ message: 'Solo puedes cancelar tus propias citas.' });
      return;
    }
  }
  if (staffInOrganization && req.user?.role === 'employee') {
    const employee = await pool.request()
      .input('userId', sql.NVarChar, req.user.id)
      .input('organizationId', sql.NVarChar, req.params.organizationId)
      .query('SELECT TOP 1 Id FROM dbo.Employees WHERE UserId = @userId AND OrganizationId = @organizationId');
    const ownEmployeeId = String(employee.recordset[0]?.Id ?? '');
    const restrictedEmployeeFields = ['date', 'time', 'employeeId', 'serviceIds', 'duration', 'total', 'subtotal', 'discountAmount', 'specialPrice', 'discountReason'];
    if (!ownEmployeeId || String(row.EmployeeId) !== ownEmployeeId || restrictedEmployeeFields.some((field) => Object.prototype.hasOwnProperty.call(req.body, field))) {
      res.status(403).json({ message: 'Solo puedes actualizar el avance de tus propias citas.' });
      return;
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || parseTimeToMinutes(nextTime) === null || !nextServiceIds.length) {
    res.status(400).json({ message: 'Fecha, hora y servicios validos son requeridos.' });
    return;
  }
  if (nextStatus !== 'cancelled' && nextStatus !== 'completed' && nextStatus !== 'lost') {
    const nextEmployee = await pool.request()
      .input('id', sql.NVarChar, nextEmployeeId)
      .input('organizationId', sql.NVarChar, req.params.organizationId)
      .query('SELECT TOP 1 Id, Active, ScheduleOverridesJson FROM dbo.Employees WHERE Id = @id AND OrganizationId = @organizationId');
    const settings = await pool.request()
      .input('organizationId', sql.NVarChar, req.params.organizationId)
      .query('SELECT TOP 1 * FROM dbo.BusinessSettings WHERE OrganizationId = @organizationId');
    if (!nextEmployee.recordset.length || !Boolean(nextEmployee.recordset[0].Active)) {
      res.status(400).json({ message: 'El empleado seleccionado no esta disponible.' });
      return;
    }
    if (!employeeScheduleAllowsSlot(nextEmployee.recordset[0], settings.recordset[0], nextDate, nextTime, nextDuration)) {
      res.status(409).json({ message: 'Ese horario queda fuera del horario del empleado.' });
      return;
    }
    const sameDayAppointments = await pool.request()
      .input('organizationId', sql.NVarChar, req.params.organizationId)
      .input('employeeId', sql.NVarChar, nextEmployeeId)
      .input('date', sql.Date, nextDate)
      .input('id', sql.NVarChar, req.params.appointmentId)
      .query(`
        SELECT Id, AppointmentTime, Duration, Status
        FROM dbo.Appointments
        WHERE OrganizationId = @organizationId AND EmployeeId = @employeeId AND AppointmentDate = @date AND Id <> @id
          AND Status NOT IN ('completed', 'lost', 'cancelled')
      `);
    const start = parseTimeToMinutes(nextTime);
    const end = (start ?? 0) + nextDuration;
    const hasConflict = sameDayAppointments.recordset.some((appointment) => {
      const appointmentStart = parseTimeToMinutes(appointment.AppointmentTime);
      if (appointmentStart === null) return false;
      const appointmentEnd = appointmentStart + appointmentDuration(appointment);
      return (start ?? 0) < appointmentEnd && end > appointmentStart;
    });
    if (hasConflict) {
      res.status(409).json({ message: 'Ese horario ya esta ocupado para el empleado seleccionado.' });
      return;
    }
    const blocks = await pool.request()
      .input('organizationId', sql.NVarChar, req.params.organizationId)
      .input('employeeId', sql.NVarChar, nextEmployeeId)
      .input('date', sql.Date, nextDate)
      .query('SELECT StartsAt, EndsAt FROM dbo.EmployeeBlocks WHERE OrganizationId = @organizationId AND EmployeeId = @employeeId AND BlockDate = @date');
    const hasBlockConflict = blocks.recordset.some((block) => {
      const blockStart = parseTimeToMinutes(block.StartsAt);
      const blockEnd = parseTimeToMinutes(block.EndsAt);
      if (blockStart === null || blockEnd === null) return false;
      return (start ?? 0) < blockEnd && end > blockStart;
    });
    if (hasBlockConflict) {
      res.status(409).json({ message: 'Ese horario esta bloqueado para el empleado seleccionado.' });
      return;
    }
  }
  await pool.request()
    .input('id', sql.NVarChar, req.params.appointmentId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('employeeId', sql.NVarChar, nextEmployeeId)
    .input('date', sql.Date, nextDate)
    .input('time', sql.NVarChar, nextTime)
    .input('duration', sql.Int, nextDuration)
    .input('serviceIdsJson', sql.NVarChar, JSON.stringify(nextServiceIds))
    .input('status', sql.NVarChar, nextStatus)
    .input('paymentStatus', sql.NVarChar, enumValue(req.body.paymentStatus, paymentStatuses, String(row.PaymentStatus ?? 'not_required')))
    .input('paymentMethod', sql.NVarChar, enumValue(req.body.paymentMethod, paymentMethods, String(row.PaymentMethod ?? 'none')))
    .input('paymentProvider', sql.NVarChar, enumValue(req.body.paymentProvider, paymentProviders, String(row.PaymentProvider ?? 'none')))
    .input('paymentReference', sql.NVarChar, String(req.body.paymentReference ?? row.PaymentReference ?? ''))
    .input('paymentStatusDetail', sql.NVarChar, String(req.body.paymentStatusDetail ?? ''))
    .input('note', sql.NVarChar, String(req.body.note ?? row.Note ?? ''))
    .input('delayNotice', sql.NVarChar, String(req.body.delayNotice ?? row.DelayNotice ?? ''))
    .input('delayMinutes', sql.Int, req.body.delayMinutes == null ? row.DelayMinutes ?? null : numberValue(req.body.delayMinutes, 0))
    .input('cancelledAt', sql.DateTime2, nextStatus === 'cancelled' && !row.CancelledAt ? new Date() : row.CancelledAt ?? null)
    .input('cancelledBy', sql.NVarChar, String(req.body.cancelledBy ?? row.CancelledBy ?? ''))
    .input('cancellationReason', sql.NVarChar, String(req.body.cancellationReason ?? row.CancellationReason ?? ''))
    .input('cancellationTiming', sql.NVarChar, String(req.body.cancellationTiming ?? row.CancellationTiming ?? ''))
    .input('refundStatus', sql.NVarChar, String(req.body.refundStatus ?? row.RefundStatus ?? 'not_applicable'))
    .input('serviceRightForfeited', sql.Bit, req.body.serviceRightForfeited == null ? Boolean(row.ServiceRightForfeited) : Boolean(req.body.serviceRightForfeited))
    .input('servicePaymentMethod', sql.NVarChar, enumValue(req.body.servicePaymentMethod, paymentMethods, String(row.ServicePaymentMethod ?? 'none')))
    .input('servicePaymentStatus', sql.NVarChar, enumValue(req.body.servicePaymentStatus, paymentStatuses, String(row.ServicePaymentStatus ?? 'not_required')))
    .input('servicePaidAt', sql.DateTime2, req.body.servicePaidAt ? new Date(String(req.body.servicePaidAt)) : row.ServicePaidAt ?? null)
    .input('total', sql.Decimal(12, 2), req.body.total == null ? numberValue(row.Total, 0) : numberValue(req.body.total, 0))
    .input('subtotal', sql.Decimal(12, 2), req.body.subtotal == null ? numberValue(row.Subtotal, 0) : numberValue(req.body.subtotal, 0))
    .input('discountAmount', sql.Decimal(12, 2), req.body.discountAmount == null ? numberValue(row.DiscountAmount, 0) : numberValue(req.body.discountAmount, 0))
    .input('specialPrice', sql.Decimal(12, 2), Object.prototype.hasOwnProperty.call(req.body, 'specialPrice') ? req.body.specialPrice == null ? null : numberValue(req.body.specialPrice, 0) : row.SpecialPrice ?? null)
    .input('discountReason', sql.NVarChar, String(req.body.discountReason ?? row.DiscountReason ?? ''))
    .query(`
      UPDATE dbo.Appointments SET EmployeeId = @employeeId, AppointmentDate = @date, AppointmentTime = @time, Duration = @duration,
        ServiceIdsJson = @serviceIdsJson, Status = @status, PaymentStatus = @paymentStatus, PaymentMethod = @paymentMethod,
        PaymentProvider = @paymentProvider, PaymentReference = @paymentReference, PaymentStatusDetail = @paymentStatusDetail, Note = @note,
        DelayNotice = @delayNotice, DelayMinutes = @delayMinutes, CancelledAt = @cancelledAt, CancelledBy = @cancelledBy,
        CancellationReason = @cancellationReason, CancellationTiming = @cancellationTiming, RefundStatus = @refundStatus,
        ServiceRightForfeited = @serviceRightForfeited, ServicePaymentMethod = @servicePaymentMethod,
        ServicePaymentStatus = @servicePaymentStatus, ServicePaidAt = @servicePaidAt, Total = @total, Subtotal = @subtotal,
        DiscountAmount = @discountAmount, SpecialPrice = @specialPrice, DiscountReason = @discountReason, UpdatedAt = sysutcdatetime()
      WHERE Id = @id AND OrganizationId = @organizationId
    `);
  if (nextStatus === 'completed' || nextStatus === 'lost' || nextStatus === 'cancelled') {
    const clientId = String(row.ClientId);
    const spent = nextStatus === 'completed' ? numberValue(req.body.total ?? row.Total, 0) : 0;
    const points = Math.floor(spent / 10);
    await pool.request()
      .input('organizationId', sql.NVarChar, req.params.organizationId)
      .input('clientId', sql.NVarChar, clientId)
      .input('spent', sql.Decimal(12, 2), spent)
      .input('points', sql.Int, points)
      .input('status', sql.NVarChar, nextStatus)
      .input('rewardLevel', sql.NVarChar, rewardLevel(points))
      .query(`
        UPDATE dbo.ClientHistories
        SET TotalSpent = TotalSpent + @spent,
          RewardPoints = RewardPoints + @points,
          RewardLevel = CASE
            WHEN RewardPoints + @points >= 1000 THEN 'vip'
            WHEN RewardPoints + @points >= 500 THEN 'gold'
            WHEN RewardPoints + @points >= 200 THEN 'silver'
            ELSE RewardLevel
          END,
          Cancellations = Cancellations + CASE WHEN @status = 'cancelled' THEN 1 ELSE 0 END,
          NoShows = NoShows + CASE WHEN @status = 'lost' THEN 1 ELSE 0 END,
          LastVisitAt = CASE WHEN @status = 'completed' THEN sysutcdatetime() ELSE LastVisitAt END,
          UpdatedAt = sysutcdatetime()
        WHERE OrganizationId = @organizationId AND ClientId = @clientId
      `);
  }
  await writeAudit(paramValue(req.params.organizationId), req, 'update', 'appointment', paramValue(req.params.appointmentId), { status: nextStatus, date: nextDate, time: nextTime });
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/appointments/:appointmentId', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.appointmentId).input('organizationId', sql.NVarChar, req.params.organizationId).query('DELETE FROM dbo.Appointments WHERE Id = @id AND OrganizationId = @organizationId');
  await writeAudit(paramValue(req.params.organizationId), req, 'delete', 'appointment', paramValue(req.params.appointmentId));
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/day-notes', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const noteId = id();
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, noteId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('date', sql.Date, String(req.body.date ?? ''))
    .input('type', sql.NVarChar, String(req.body.type ?? 'closed'))
    .input('note', sql.NVarChar, String(req.body.note ?? ''))
    .query('INSERT INTO dbo.DayNotes (Id, OrganizationId, NoteDate, Type, Note) VALUES (@id, @organizationId, @date, @type, @note)');
  await writeAudit(paramValue(req.params.organizationId), req, 'create', 'day_note', noteId, { date: req.body.date, type: req.body.type });
  res.status(201).json({ id: noteId });
});

app.delete('/organizations/:organizationId/day-notes/:noteId', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.noteId).input('organizationId', sql.NVarChar, req.params.organizationId).query('DELETE FROM dbo.DayNotes WHERE Id = @id AND OrganizationId = @organizationId');
  await writeAudit(paramValue(req.params.organizationId), req, 'delete', 'day_note', paramValue(req.params.noteId));
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/announcements', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const announcementId = id();
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, announcementId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('title', sql.NVarChar, String(req.body.title ?? ''))
    .input('body', sql.NVarChar, String(req.body.body ?? ''))
    .input('audience', sql.NVarChar, enumValue(req.body.audience, ['clients', 'employees', 'all'] as const, 'all'))
    .input('active', sql.Bit, Boolean(req.body.active ?? true))
    .query('INSERT INTO dbo.Announcements (Id, OrganizationId, Title, Body, Audience, Active) VALUES (@id, @organizationId, @title, @body, @audience, @active)');
  await writeAudit(paramValue(req.params.organizationId), req, 'create', 'announcement', announcementId, { audience: req.body.audience });
  res.status(201).json({ id: announcementId });
});

app.patch('/organizations/:organizationId/announcements/:announcementId', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.announcementId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('active', sql.Bit, Boolean(req.body.active))
    .query('UPDATE dbo.Announcements SET Active = @active, UpdatedAt = sysutcdatetime() WHERE Id = @id AND OrganizationId = @organizationId');
  await writeAudit(paramValue(req.params.organizationId), req, 'update', 'announcement', paramValue(req.params.announcementId), { active: req.body.active });
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/announcements/:announcementId', requireAuth, async (req, res) => {
  if (!assertOrgScheduler(req, res)) return;
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.announcementId).input('organizationId', sql.NVarChar, req.params.organizationId).query('DELETE FROM dbo.Announcements WHERE Id = @id AND OrganizationId = @organizationId');
  await writeAudit(paramValue(req.params.organizationId), req, 'delete', 'announcement', paramValue(req.params.announcementId));
  res.json({ ok: true });
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ message: 'El logo no puede pesar mas de 2 MB.' });
    return;
  }
  res.status(500).json({ message: error instanceof Error ? error.message : 'Error inesperado del servidor.' });
});

const port = Number(process.env.PORT || 4000);
ensureDatabaseShape()
  .then(() => {
    app.listen(port, () => {
      console.log(`ServiCitas API escuchando en http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('No se pudo preparar SQL Server:', error);
    process.exit(1);
  });
