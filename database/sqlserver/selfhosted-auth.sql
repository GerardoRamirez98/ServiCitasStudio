USE ServiCitasStudio;
GO

IF COL_LENGTH('dbo.Users', 'PasswordHash') IS NULL
BEGIN
  ALTER TABLE dbo.Users ADD PasswordHash nvarchar(200) NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_Email')
BEGIN
  CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(Email);
END;
GO

IF COL_LENGTH('dbo.Appointments', 'PaymentStatusDetail') IS NULL
BEGIN
  ALTER TABLE dbo.Appointments ADD PaymentStatusDetail nvarchar(300) NULL;
END;
GO

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
GO

IF COL_LENGTH('dbo.Services', 'CategoryId') IS NULL
  ALTER TABLE dbo.Services ADD CategoryId nvarchar(128) NULL;
GO

IF COL_LENGTH('dbo.Employees', 'SpecialtiesJson') IS NULL
  ALTER TABLE dbo.Employees ADD SpecialtiesJson nvarchar(max) NULL;
IF COL_LENGTH('dbo.Announcements', 'Audience') IS NULL
  ALTER TABLE dbo.Announcements ADD Audience nvarchar(40) NOT NULL CONSTRAINT DF_Announcements_Audience DEFAULT 'all';
GO

IF OBJECT_ID('dbo.ServiceCategories', 'U') IS NULL
BEGIN
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
END;
GO

IF OBJECT_ID('dbo.PortfolioItems', 'U') IS NULL
BEGIN
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
END;
GO
