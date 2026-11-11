ALTER TABLE "UserAccount" ADD COLUMN "role" VARCHAR(10) NOT NULL DEFAULT 'user';
ALTER TABLE "UserAccount" ADD CONSTRAINT "UserAccount_role_check" CHECK ("role" IN ('user', 'admin'));
ALTER TABLE "Pack"
  ADD COLUMN "status" VARCHAR(12) NOT NULL DEFAULT 'draft',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "authorId" UUID,
  ADD COLUMN "isOfficial" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coverId" UUID,
  ADD COLUMN "submittedAt" TIMESTAMPTZ(3),
  ADD COLUMN "reviewedAt" TIMESTAMPTZ(3),
  ADD COLUMN "reviewedById" UUID,
  ADD COLUMN "rejectionReason" VARCHAR(1000);
UPDATE "Pack" SET "status" = 'approved' WHERE "published" = true;
ALTER TABLE "Pack"
  ADD CONSTRAINT "Pack_status_check" CHECK ("status" IN ('draft', 'pending', 'approved', 'rejected')),
  ADD CONSTRAINT "Pack_publication_check" CHECK ("published" = ("status" = 'approved')),
  ADD CONSTRAINT "Pack_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Pack_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Pack_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Pack_status_submittedAt_idx" ON "Pack"("status", "submittedAt");
CREATE INDEX "Pack_authorId_idx" ON "Pack"("authorId");
