CREATE TABLE "PackRating" (
    "packKey" VARCHAR(100) NOT NULL,
    "userId" UUID NOT NULL,
    "packId" UUID,
    "value" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PackRating_pkey" PRIMARY KEY ("packKey", "userId"),
    CONSTRAINT "PackRating_value_check" CHECK ("value" BETWEEN 1 AND 5),
    CONSTRAINT "PackRating_packKey_check" CHECK ("packId" IS NULL OR "packKey" = "packId"::text),
    CONSTRAINT "PackRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackRating_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PackRating_packId_idx" ON "PackRating"("packId");
CREATE INDEX "PackRating_userId_idx" ON "PackRating"("userId");
