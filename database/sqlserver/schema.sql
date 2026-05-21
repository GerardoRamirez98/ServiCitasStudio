SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_ID(N'ServiCitasStudio') IS NULL
BEGIN
  CREATE DATABASE ServiCitasStudio;
END;
GO

USE ServiCitasStudio;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE TABLE dbo.Organizations (
  Id nvarchar(128) NOT NULL CONSTRAINT PK_Organizations PRIMARY KEY,
  Name nvarchar(200) NOT NULL,
  OwnerId nvarchar(128) NOT NULL,
  PublicCode nvarchar(40) NULL,
  Slug nvarchar(160) NULL,
  AddressJson nvarchar(max) NULL,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_Organizations_CreatedAt DEFAULT sysutcdatetime(),
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_Organizations_UpdatedAt DEFAULT sysutcdatetime()
);
GO

CREATE UNIQUE INDEX UX_Organizations_PublicCode ON dbo.Organizations(PublicCode) WHERE PublicCode IS NOT NULL;
GO

CREATE TABLE dbo.Users (
  Id nvarchar(128) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
  Name nvarchar(200) NOT NULL,
  Email nvarchar(320) NOT NULL,
  PasswordHash nvarchar(200) NULL,
  Role nvarchar(40) NOT NULL,
  OrganizationId nvarchar(128) NOT NULL,
  OrganizationName nvarchar(200) NOT NULL,
  EmployeeId nvarchar(128) NULL,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT sysutcdatetime(),
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_Users_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
);
GO

CREATE INDEX IX_Users_OrganizationId ON dbo.Users(OrganizationId);
GO

CREATE TABLE dbo.ClientOrganizations (
  ClientId nvarchar(128) NOT NULL,
  OrganizationId nvarchar(128) NOT NULL,
  FollowedAt datetime2 NOT NULL CONSTRAINT DF_ClientOrganizations_FollowedAt DEFAULT sysutcdatetime(),
  LastSelectedAt datetime2 NULL,
  CONSTRAINT PK_ClientOrganizations PRIMARY KEY (ClientId, OrganizationId),
  CONSTRAINT FK_ClientOrganizations_Users FOREIGN KEY (ClientId) REFERENCES dbo.Users(Id),
  CONSTRAINT FK_ClientOrganizations_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
);
GO

CREATE INDEX IX_ClientOrganizations_OrganizationId ON dbo.ClientOrganizations(OrganizationId, FollowedAt DESC);
GO

CREATE TABLE dbo.Services (
  Id nvarchar(128) NOT NULL CONSTRAINT PK_Services PRIMARY KEY,
  OrganizationId nvarchar(128) NOT NULL,
  Name nvarchar(200) NOT NULL,
  Price decimal(12, 2) NOT NULL,
  Duration int NOT NULL,
  Active bit NOT NULL CONSTRAINT DF_Services_Active DEFAULT 1,
  CategoryId nvarchar(128) NULL,
  EmployeeDurationsJson nvarchar(max) NULL,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_Services_CreatedAt DEFAULT sysutcdatetime(),
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_Services_UpdatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_Services_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
);
GO

CREATE INDEX IX_Services_OrganizationId ON dbo.Services(OrganizationId);
GO

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
GO

CREATE INDEX IX_ServiceCategories_OrganizationId ON dbo.ServiceCategories(OrganizationId, SortOrder, Name);
GO

CREATE TABLE dbo.Employees (
  Id nvarchar(128) NOT NULL CONSTRAINT PK_Employees PRIMARY KEY,
  OrganizationId nvarchar(128) NOT NULL,
  UserId nvarchar(128) NULL,
  Name nvarchar(200) NOT NULL,
  Email nvarchar(320) NULL,
  Role nvarchar(40) NOT NULL,
  SpecialtiesJson nvarchar(max) NULL,
  Active bit NOT NULL CONSTRAINT DF_Employees_Active DEFAULT 1,
  InviteCode nvarchar(40) NULL,
  CompensationMode nvarchar(40) NULL,
  FixedSalary decimal(12, 2) NULL,
  CommissionPercent decimal(5, 2) NULL,
  ServiceDurationsJson nvarchar(max) NULL,
  ScheduleOverridesJson nvarchar(max) NULL,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_Employees_CreatedAt DEFAULT sysutcdatetime(),
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_Employees_UpdatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_Employees_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
);
GO

CREATE INDEX IX_Employees_OrganizationId ON dbo.Employees(OrganizationId);
GO

CREATE TABLE dbo.Appointments (
  Id nvarchar(128) NOT NULL CONSTRAINT PK_Appointments PRIMARY KEY,
  OrganizationId nvarchar(128) NOT NULL,
  ClientId nvarchar(128) NOT NULL,
  ClientName nvarchar(200) NOT NULL,
  AppointmentDate date NOT NULL,
  AppointmentTime time(0) NOT NULL,
  EndTime time(0) NULL,
  Duration int NULL,
  ServiceIdsJson nvarchar(max) NOT NULL,
  EmployeeId nvarchar(128) NOT NULL,
  Status nvarchar(40) NOT NULL,
  Note nvarchar(max) NULL,
  Deposit decimal(12, 2) NOT NULL CONSTRAINT DF_Appointments_Deposit DEFAULT 0,
  RequiresDeposit bit NOT NULL CONSTRAINT DF_Appointments_RequiresDeposit DEFAULT 0,
  DepositPercent decimal(5, 2) NULL,
  PaymentStatus nvarchar(40) NULL,
  PaymentMethod nvarchar(40) NULL,
  PaymentProvider nvarchar(40) NULL,
  RequestedDepositPaymentMethod nvarchar(40) NULL,
  PaymentReference nvarchar(200) NULL,
  PaymentStatusDetail nvarchar(300) NULL,
  DelayNotice nvarchar(500) NULL,
  DelayMinutes int NULL,
  Total decimal(12, 2) NOT NULL,
  Subtotal decimal(12, 2) NULL,
  DiscountAmount decimal(12, 2) NULL,
  SpecialPrice decimal(12, 2) NULL,
  DiscountReason nvarchar(300) NULL,
  CancelledAt datetime2 NULL,
  CancelledBy nvarchar(40) NULL,
  CancellationReason nvarchar(500) NULL,
  CancellationTiming nvarchar(40) NULL,
  RefundStatus nvarchar(40) NULL,
  ServiceRightForfeited bit NULL,
  ServicePaymentMethod nvarchar(40) NULL,
  ServicePaymentStatus nvarchar(40) NULL,
  ServicePaidAt datetime2 NULL,
  TermsAccepted bit NOT NULL CONSTRAINT DF_Appointments_TermsAccepted DEFAULT 0,
  Source nvarchar(40) NULL,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_Appointments_CreatedAt DEFAULT sysutcdatetime(),
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_Appointments_UpdatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_Appointments_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id),
  CONSTRAINT FK_Appointments_Employees FOREIGN KEY (EmployeeId) REFERENCES dbo.Employees(Id)
);
GO

CREATE INDEX IX_Appointments_Organization_Date ON dbo.Appointments(OrganizationId, AppointmentDate, AppointmentTime);
CREATE INDEX IX_Appointments_Employee_Date ON dbo.Appointments(EmployeeId, AppointmentDate, AppointmentTime);
GO

CREATE TABLE dbo.DayNotes (
  Id nvarchar(128) NOT NULL CONSTRAINT PK_DayNotes PRIMARY KEY,
  OrganizationId nvarchar(128) NOT NULL,
  NoteDate date NOT NULL,
  Type nvarchar(40) NOT NULL,
  Note nvarchar(max) NOT NULL,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_DayNotes_CreatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_DayNotes_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
);
GO

CREATE TABLE dbo.Announcements (
  Id nvarchar(128) NOT NULL CONSTRAINT PK_Announcements PRIMARY KEY,
  OrganizationId nvarchar(128) NOT NULL,
  Title nvarchar(200) NOT NULL,
  Body nvarchar(max) NOT NULL,
  Audience nvarchar(40) NOT NULL CONSTRAINT DF_Announcements_Audience DEFAULT 'all',
  Active bit NOT NULL CONSTRAINT DF_Announcements_Active DEFAULT 1,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_Announcements_CreatedAt DEFAULT sysutcdatetime(),
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_Announcements_UpdatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_Announcements_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
);
GO

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
GO

CREATE INDEX IX_PortfolioItems_OrganizationId ON dbo.PortfolioItems(OrganizationId, CreatedAt DESC);
GO

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
GO

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
GO

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
GO

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
GO

CREATE TABLE dbo.BusinessSettings (
  OrganizationId nvarchar(128) NOT NULL CONSTRAINT PK_BusinessSettings PRIMARY KEY,
  RequireDeposit bit NOT NULL,
  DepositPercent decimal(5, 2) NOT NULL,
  ToleranceMinutes int NOT NULL,
  CancellationLimitHours int NOT NULL,
  BusinessStart time(0) NOT NULL,
  BusinessEnd time(0) NOT NULL,
  BreakEnabled bit NOT NULL,
  BreakStart time(0) NULL,
  BreakEnd time(0) NULL,
  SlotMinutes int NOT NULL,
  WorkingDaysJson nvarchar(max) NOT NULL,
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_BusinessSettings_UpdatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_BusinessSettings_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
);
GO

CREATE TABLE dbo.AppearanceSettings (
  OrganizationId nvarchar(128) NOT NULL CONSTRAINT PK_AppearanceSettings PRIMARY KEY,
  Preset nvarchar(40) NOT NULL,
  DisplayName nvarchar(200) NOT NULL,
  Tagline nvarchar(300) NOT NULL,
  WelcomeMessage nvarchar(max) NOT NULL,
  LogoUrl nvarchar(1000) NULL,
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_AppearanceSettings_UpdatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_AppearanceSettings_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
);
GO
