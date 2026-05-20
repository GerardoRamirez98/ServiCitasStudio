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
const staffRoles: UserRole[] = ['owner', 'admin', 'manager', 'receptionist', 'employee'];
const appointmentStatuses = ['pending', 'confirmed', 'waiting', 'in_service', 'completed', 'lost', 'cancelled'];
const paymentStatuses = ['not_required', 'pending', 'paid', 'offline', 'refunded'];
const paymentMethods = ['none', 'card', 'cash', 'transfer', 'mercado_pago', 'spei', 'oxxo'];
const paymentProviders = ['none', 'mercado_pago'];
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

function userRowToProfile(row: Record<string, unknown>) {
  return {
    id: String(row.Id),
    name: String(row.Name),
    email: String(row.Email),
    role: allowedRoles.includes(row.Role as UserRole) ? (row.Role as UserRole) : 'client',
    organizationId: String(row.OrganizationId),
    organizationName: String(row.OrganizationName),
    employeeId: row.EmployeeId ? String(row.EmployeeId) : undefined,
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

function isStaff(req: express.Request) {
  return Boolean(req.user?.role && staffRoles.includes(req.user.role));
}

function localUploadPathFromUrl(value: unknown) {
  const logoUrl = String(value ?? '');
  if (!logoUrl.startsWith('/uploads/')) return null;
  const relativePath = logoUrl.replace(/^\/uploads\//, '').replace(/[\\/]+/g, path.sep);
  const resolvedPath = path.resolve(uploadsRoot, relativePath);
  return resolvedPath.startsWith(uploadsRoot) ? resolvedPath : null;
}

async function ensureDatabaseShape() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_Email')
      CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(Email);

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
    IF COL_LENGTH('dbo.Employees', 'SpecialtiesJson') IS NULL
      ALTER TABLE dbo.Employees ADD SpecialtiesJson nvarchar(max) NULL;
    IF COL_LENGTH('dbo.Announcements', 'Audience') IS NULL
      ALTER TABLE dbo.Announcements ADD Audience nvarchar(40) NOT NULL CONSTRAINT DF_Announcements_Audience DEFAULT 'all';
  `);
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
      .query(`
        INSERT INTO dbo.Users (Id, Name, Email, PasswordHash, Role, OrganizationId, OrganizationName, EmployeeId)
        VALUES (@id, @name, @email, @passwordHash, @role, @organizationId, @organizationName, @employeeId)
      `);

    if (employeeId) {
      await pool
        .request()
        .input('id', sql.NVarChar, employeeId)
        .input('userId', sql.NVarChar, userId)
        .query('UPDATE dbo.Employees SET UserId = @userId, UpdatedAt = sysutcdatetime() WHERE Id = @id');
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

app.get('/organizations/:id/bootstrap', requireAuth, async (req, res) => {
  if (req.user?.organizationId !== req.params.id) {
    res.status(403).json({ message: 'No tienes acceso a este negocio.' });
    return;
  }
  const pool = await getPool();
  const organization = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Organizations WHERE Id = @id');
  const settings = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.BusinessSettings WHERE OrganizationId = @id');
  const appearance = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.AppearanceSettings WHERE OrganizationId = @id');
  const services = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Services WHERE OrganizationId = @id ORDER BY Name');
  const employees = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Employees WHERE OrganizationId = @id ORDER BY Name');
  const appointments = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT TOP 1000 * FROM dbo.Appointments WHERE OrganizationId = @id ORDER BY AppointmentDate DESC, AppointmentTime DESC');
  const dayNotes = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.DayNotes WHERE OrganizationId = @id ORDER BY NoteDate');
  const announcements = await pool.request().input('id', sql.NVarChar, req.params.id).query('SELECT * FROM dbo.Announcements WHERE OrganizationId = @id ORDER BY Title');

  res.json({
    organization: organization.recordset[0] ?? null,
    settings: settings.recordset[0] ?? null,
    appearance: appearance.recordset[0] ?? null,
    services: services.recordset,
    employees: employees.recordset,
    appointments: appointments.recordset,
    dayNotes: dayNotes.recordset,
    announcements: announcements.recordset,
  });
});

app.get('/organizations/:organizationId/reports/finance', requireAuth, async (req, res) => {
  if (!assertOrgStaff(req, res)) return;
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
        RequireDeposit = @requireDeposit, DepositPercent = @depositPercent, ToleranceMinutes = @toleranceMinutes,
        CancellationLimitHours = @cancellationLimitHours, BusinessStart = @businessStart, BusinessEnd = @businessEnd,
        BreakEnabled = @breakEnabled, BreakStart = @breakStart, BreakEnd = @breakEnd, SlotMinutes = @slotMinutes,
        WorkingDaysJson = @workingDaysJson, UpdatedAt = sysutcdatetime()
      WHEN NOT MATCHED THEN INSERT
        (OrganizationId, RequireDeposit, DepositPercent, ToleranceMinutes, CancellationLimitHours, BusinessStart, BusinessEnd, BreakEnabled, BreakStart, BreakEnd, SlotMinutes, WorkingDaysJson)
        VALUES (@organizationId, @requireDeposit, @depositPercent, @toleranceMinutes, @cancellationLimitHours, @businessStart, @businessEnd, @breakEnabled, @breakStart, @breakEnd, @slotMinutes, @workingDaysJson);
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
    .query('INSERT INTO dbo.Services (Id, OrganizationId, Name, Price, Duration, Active) VALUES (@id, @organizationId, @name, @price, @duration, @active)');
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
    .query('UPDATE dbo.Services SET Name = @name, Price = @price, Duration = @duration, Active = @active, UpdatedAt = sysutcdatetime() WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/services/:serviceId', requireAuth, async (req, res) => {
  if (!assertOrgAdmin(req, res)) return;
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.serviceId).input('organizationId', sql.NVarChar, req.params.organizationId).query('DELETE FROM dbo.Services WHERE Id = @id AND OrganizationId = @organizationId');
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
    .query(`
      INSERT INTO dbo.Employees (Id, OrganizationId, Name, Email, Role, SpecialtiesJson, Active, InviteCode, CompensationMode, FixedSalary, CommissionPercent)
      VALUES (@id, @organizationId, @name, @email, @role, @specialtiesJson, @active, @inviteCode, @compensationMode, @fixedSalary, @commissionPercent)
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
    .query(`
      UPDATE dbo.Employees SET Name = @name, Email = @email, Role = @role, SpecialtiesJson = @specialtiesJson, Active = @active, InviteCode = @inviteCode,
        CompensationMode = @compensationMode, FixedSalary = @fixedSalary, CommissionPercent = @commissionPercent, UpdatedAt = sysutcdatetime()
      WHERE Id = @id AND OrganizationId = @organizationId
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
  if (!assertSameOrg(req, res)) return;
  const appointmentId = id();
  const organizationId = paramValue(req.params.organizationId);
  const source = enumValue(req.body.source, ['client', 'manual'] as const, 'client');
  if (source === 'manual' && !isStaff(req)) {
    res.status(403).json({ message: 'Solo el personal puede crear citas manuales.' });
    return;
  }
  if (source === 'client' && req.user?.role === 'client' && String(req.body.clientId ?? req.user.id) !== req.user.id) {
    res.status(403).json({ message: 'No puedes agendar a nombre de otro cliente.' });
    return;
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

  const pool = await getPool();
  const services = await pool
    .request()
    .input('organizationId', sql.NVarChar, organizationId)
    .query('SELECT Id, Duration, Active FROM dbo.Services WHERE OrganizationId = @organizationId');
  const serviceMap = new Map(services.recordset.map((service) => [String(service.Id), service]));
  const missingService = serviceIds.some((serviceId) => !serviceMap.has(serviceId));
  if (missingService) {
    res.status(400).json({ message: 'Uno o mas servicios no existen en este negocio.' });
    return;
  }
  const duration = requestedDuration || serviceIds.reduce((sum, serviceId) => sum + numberValue(serviceMap.get(serviceId)?.Duration, 0), 0) || 60;
  const employee = await pool
    .request()
    .input('id', sql.NVarChar, employeeId)
    .input('organizationId', sql.NVarChar, organizationId)
    .query('SELECT Id, Active FROM dbo.Employees WHERE Id = @id AND OrganizationId = @organizationId');
  if (!employee.recordset.length || !Boolean(employee.recordset[0].Active)) {
    res.status(400).json({ message: 'El empleado seleccionado no esta disponible.' });
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

  const deposit = numberValue(req.body.deposit, 0);
  const paymentMethod = enumValue(req.body.paymentMethod, paymentMethods, 'none');
  const requestedDepositPaymentMethod = enumValue(req.body.requestedDepositPaymentMethod, paymentMethods, paymentMethod);
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
    .input('total', sql.Decimal(12, 2), numberValue(req.body.total, 0))
    .input('subtotal', sql.Decimal(12, 2), numberValue(req.body.subtotal, numberValue(req.body.total, 0)))
    .input('discountAmount', sql.Decimal(12, 2), numberValue(req.body.discountAmount, 0))
    .input('specialPrice', sql.Decimal(12, 2), req.body.specialPrice == null ? null : numberValue(req.body.specialPrice, 0))
    .input('discountReason', sql.NVarChar, String(req.body.discountReason ?? ''))
    .input('termsAccepted', sql.Bit, Boolean(req.body.termsAccepted))
    .input('source', sql.NVarChar, source)
    .query(`
      INSERT INTO dbo.Appointments
        (Id, OrganizationId, ClientId, ClientName, AppointmentDate, AppointmentTime, EndTime, Duration, ServiceIdsJson, EmployeeId, Status, Note, Deposit, RequiresDeposit, DepositPercent, PaymentStatus, PaymentMethod, PaymentProvider, RequestedDepositPaymentMethod, Total, Subtotal, DiscountAmount, SpecialPrice, DiscountReason, TermsAccepted, Source)
      VALUES
        (@id, @organizationId, @clientId, @clientName, @date, @time, @endTime, @duration, @serviceIdsJson, @employeeId, @status, @note, @deposit, @requiresDeposit, @depositPercent, @paymentStatus, @paymentMethod, @paymentProvider, @requestedDepositPaymentMethod, @total, @subtotal, @discountAmount, @specialPrice, @discountReason, @termsAccepted, @source)
    `);
  res.status(201).json({ appointmentId, employeeId });
});

app.patch('/organizations/:organizationId/appointments/:appointmentId', requireAuth, async (req, res) => {
  if (!assertSameOrg(req, res)) return;
  const pool = await getPool();
  const current = await pool.request().input('id', sql.NVarChar, req.params.appointmentId).input('organizationId', sql.NVarChar, req.params.organizationId).query('SELECT * FROM dbo.Appointments WHERE Id = @id AND OrganizationId = @organizationId');
  if (!current.recordset.length) {
    res.status(404).json({ message: 'Cita no encontrada.' });
    return;
  }
  const row = current.recordset[0];
  const nextStatus = enumValue(req.body.status, appointmentStatuses, String(row.Status));
  if (!isStaff(req)) {
    const isOwnAppointment = String(row.ClientId) === req.user?.id;
    const clientOnlyCancellation = isOwnAppointment && nextStatus === 'cancelled';
    if (!clientOnlyCancellation) {
      res.status(403).json({ message: 'Solo puedes cancelar tus propias citas.' });
      return;
    }
  }
  await pool.request()
    .input('id', sql.NVarChar, req.params.appointmentId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('employeeId', sql.NVarChar, String(req.body.employeeId ?? row.EmployeeId))
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
    .query(`
      UPDATE dbo.Appointments SET EmployeeId = @employeeId, Status = @status, PaymentStatus = @paymentStatus, PaymentMethod = @paymentMethod,
        PaymentProvider = @paymentProvider, PaymentReference = @paymentReference, PaymentStatusDetail = @paymentStatusDetail, Note = @note,
        DelayNotice = @delayNotice, DelayMinutes = @delayMinutes, CancelledAt = @cancelledAt, CancelledBy = @cancelledBy,
        CancellationReason = @cancellationReason, CancellationTiming = @cancellationTiming, RefundStatus = @refundStatus,
        ServiceRightForfeited = @serviceRightForfeited, ServicePaymentMethod = @servicePaymentMethod,
        ServicePaymentStatus = @servicePaymentStatus, ServicePaidAt = @servicePaidAt, UpdatedAt = sysutcdatetime()
      WHERE Id = @id AND OrganizationId = @organizationId
    `);
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/appointments/:appointmentId', requireAuth, async (req, res) => {
  if (!assertOrgStaff(req, res)) return;
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.appointmentId).input('organizationId', sql.NVarChar, req.params.organizationId).query('DELETE FROM dbo.Appointments WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/day-notes', requireAuth, async (req, res) => {
  if (!assertOrgStaff(req, res)) return;
  const noteId = id();
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, noteId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('date', sql.Date, String(req.body.date ?? ''))
    .input('type', sql.NVarChar, String(req.body.type ?? 'closed'))
    .input('note', sql.NVarChar, String(req.body.note ?? ''))
    .query('INSERT INTO dbo.DayNotes (Id, OrganizationId, NoteDate, Type, Note) VALUES (@id, @organizationId, @date, @type, @note)');
  res.status(201).json({ id: noteId });
});

app.delete('/organizations/:organizationId/day-notes/:noteId', requireAuth, async (req, res) => {
  if (!assertOrgStaff(req, res)) return;
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.noteId).input('organizationId', sql.NVarChar, req.params.organizationId).query('DELETE FROM dbo.DayNotes WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true });
});

app.post('/organizations/:organizationId/announcements', requireAuth, async (req, res) => {
  if (!assertOrgStaff(req, res)) return;
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
  res.status(201).json({ id: announcementId });
});

app.patch('/organizations/:organizationId/announcements/:announcementId', requireAuth, async (req, res) => {
  if (!assertOrgStaff(req, res)) return;
  const pool = await getPool();
  await pool.request()
    .input('id', sql.NVarChar, req.params.announcementId)
    .input('organizationId', sql.NVarChar, req.params.organizationId)
    .input('active', sql.Bit, Boolean(req.body.active))
    .query('UPDATE dbo.Announcements SET Active = @active, UpdatedAt = sysutcdatetime() WHERE Id = @id AND OrganizationId = @organizationId');
  res.json({ ok: true });
});

app.delete('/organizations/:organizationId/announcements/:announcementId', requireAuth, async (req, res) => {
  if (!assertOrgStaff(req, res)) return;
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.announcementId).input('organizationId', sql.NVarChar, req.params.organizationId).query('DELETE FROM dbo.Announcements WHERE Id = @id AND OrganizationId = @organizationId');
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
