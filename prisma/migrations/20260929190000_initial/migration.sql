CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "CertificateStatus" AS ENUM ('PROCESSING', 'ISSUED', 'FAILED', 'REVOKED', 'SUPERSEDED');
CREATE TYPE "DeliveryMode" AS ENUM ('ONLINE', 'IN_PERSON');

CREATE TABLE "Integration" (
    "id" UUID NOT NULL,
    "namespace" VARCHAR(100) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "institutionId" VARCHAR(100) NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationClient" (
    "id" UUID NOT NULL,
    "clientId" VARCHAR(100) NOT NULL,
    "integrationId" UUID NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "secretKeyVersion" VARCHAR(100) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    CONSTRAINT "IntegrationClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsedNonce" (
    "id" UUID NOT NULL,
    "clientDbId" UUID NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsedNonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "clientDbId" UUID NOT NULL,
    "key" VARCHAR(36) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "state" VARCHAR(30) NOT NULL,
    "resourceId" UUID,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CertificateSeries" (
    "id" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "identityKey" VARCHAR(1024) NOT NULL,
    "externalStudentId" VARCHAR(128) NOT NULL,
    "courseId" VARCHAR(128) NOT NULL,
    "deliveryMode" "DeliveryMode" NOT NULL,
    "classId" VARCHAR(128),
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CertificateSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Certificate" (
    "id" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "seriesId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'PROCESSING',
    "certificateType" VARCHAR(100) NOT NULL,
    "verificationCode" VARCHAR(64) NOT NULL,
    "registrationYear" INTEGER NOT NULL,
    "registrationSequence" INTEGER NOT NULL,
    "registrationNumber" VARCHAR(40) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "templateVersion" VARCHAR(100) NOT NULL,
    "pdfObjectKey" VARCHAR(1024),
    "pdfSha256" CHAR(64),
    "pdfSizeBytes" BIGINT,
    "completedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "revocationReason" VARCHAR(1000),
    "supersedesId" UUID,
    "failureCode" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RegistrationCounter" (
    "institutionId" VARCHAR(100) NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "RegistrationCounter_pkey" PRIMARY KEY ("institutionId", "year")
);

CREATE TABLE "RateLimitBucket" (
    "bucketKey" VARCHAR(512) NOT NULL,
    "tokens" DECIMAL(12,4) NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("bucketKey")
);

CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "integrationId" UUID,
    "clientId" VARCHAR(100),
    "actorId" VARCHAR(128),
    "eventType" VARCHAR(100) NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "requestId" VARCHAR(128) NOT NULL,
    "reference" VARCHAR(512),
    "details" JSONB,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Integration_namespace_key" ON "Integration"("namespace");
CREATE UNIQUE INDEX "IntegrationClient_clientId_key" ON "IntegrationClient"("clientId");
CREATE INDEX "IntegrationClient_integrationId_status_idx" ON "IntegrationClient"("integrationId", "status");
CREATE INDEX "UsedNonce_expiresAt_idx" ON "UsedNonce"("expiresAt");
CREATE UNIQUE INDEX "UsedNonce_clientDbId_nonce_key" ON "UsedNonce"("clientDbId", "nonce");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE UNIQUE INDEX "IdempotencyRecord_clientDbId_key_key" ON "IdempotencyRecord"("clientDbId", "key");
CREATE INDEX "CertificateSeries_integrationId_externalStudentId_courseId_idx" ON "CertificateSeries"("integrationId", "externalStudentId", "courseId");
CREATE UNIQUE INDEX "CertificateSeries_integrationId_identityKey_key" ON "CertificateSeries"("integrationId", "identityKey");
CREATE UNIQUE INDEX "Certificate_verificationCode_key" ON "Certificate"("verificationCode");
CREATE INDEX "Certificate_seriesId_status_idx" ON "Certificate"("seriesId", "status");
CREATE INDEX "Certificate_integrationId_createdAt_idx" ON "Certificate"("integrationId", "createdAt");
CREATE UNIQUE INDEX "Certificate_seriesId_revision_key" ON "Certificate"("seriesId", "revision");
CREATE UNIQUE INDEX "Certificate_integrationId_registrationYear_registrationSequence_key" ON "Certificate"("integrationId", "registrationYear", "registrationSequence");
CREATE UNIQUE INDEX "Certificate_integrationId_registrationNumber_key" ON "Certificate"("integrationId", "registrationNumber");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
CREATE INDEX "AuditEvent_integrationId_occurredAt_idx" ON "AuditEvent"("integrationId", "occurredAt");
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");
CREATE UNIQUE INDEX "Certificate_one_processing_per_series_key"
ON "Certificate"("seriesId") WHERE "status" = 'PROCESSING';
CREATE UNIQUE INDEX "Certificate_one_issued_per_series_key"
ON "Certificate"("seriesId") WHERE "status" = 'ISSUED';

ALTER TABLE "CertificateSeries"
ADD CONSTRAINT "CertificateSeries_deliveryMode_classId_check"
CHECK (("deliveryMode" = 'ONLINE' AND "classId" IS NULL) OR ("deliveryMode" = 'IN_PERSON' AND "classId" IS NOT NULL));

ALTER TABLE "IntegrationClient" ADD CONSTRAINT "IntegrationClient_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsedNonce" ADD CONSTRAINT "UsedNonce_clientDbId_fkey" FOREIGN KEY ("clientDbId") REFERENCES "IntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_clientDbId_fkey" FOREIGN KEY ("clientDbId") REFERENCES "IntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CertificateSeries" ADD CONSTRAINT "CertificateSeries_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "CertificateSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
