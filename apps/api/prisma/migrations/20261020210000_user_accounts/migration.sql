CREATE TABLE "UserAccount" (
  "id" UUID NOT NULL PRIMARY KEY,
  "email" VARCHAR(254) NOT NULL UNIQUE,
  "displayName" VARCHAR(40) NOT NULL,
  "passwordHash" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AuthSession" (
  "id" UUID NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "UserAccount"("id") ON DELETE CASCADE,
  "tokenHash" CHAR(64) NOT NULL UNIQUE,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
ALTER TABLE "GameParticipant" ADD COLUMN "userId" UUID REFERENCES "UserAccount"("id") ON DELETE SET NULL;
