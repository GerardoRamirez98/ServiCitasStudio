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

CREATE TABLE dbo.Employees (
  Id nvarchar(128) NOT NULL CONSTRAINT PK_Employees PRIMARY KEY,
  OrganizationId nvarchar(128) NOT NULL,
  UserId nvarchar(128) NULL,
  Name nvarchar(200) NOT NULL,
  Email nvarchar(320) NULL,
  Role nvarchar(40) NOT NULL,
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
  Active bit NOT NULL CONSTRAINT DF_Announcements_Active DEFAULT 1,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_Announcements_CreatedAt DEFAULT sysutcdatetime(),
  UpdatedAt datetime2 NOT NULL CONSTRAINT DF_Announcements_UpdatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT FK_Announcements_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(Id)
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
