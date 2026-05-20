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

IF COL_LENGTH('dbo.Employees', 'SpecialtiesJson') IS NULL
  ALTER TABLE dbo.Employees ADD SpecialtiesJson nvarchar(max) NULL;
IF COL_LENGTH('dbo.Announcements', 'Audience') IS NULL
  ALTER TABLE dbo.Announcements ADD Audience nvarchar(40) NOT NULL CONSTRAINT DF_Announcements_Audience DEFAULT 'all';
GO
