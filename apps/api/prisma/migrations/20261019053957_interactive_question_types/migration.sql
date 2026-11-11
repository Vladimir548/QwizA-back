-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuestionKind" ADD VALUE 'geo';
ALTER TYPE "QuestionKind" ADD VALUE 'image_point';
ALTER TYPE "QuestionKind" ADD VALUE 'comparison';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "comparisonUnit" VARCHAR(30),
ADD COLUMN     "geoLat" DOUBLE PRECISION,
ADD COLUMN     "geoLng" DOUBLE PRECISION,
ADD COLUMN     "geoToleranceKm" DOUBLE PRECISION,
ADD COLUMN     "imageTolerancePercent" DOUBLE PRECISION,
ADD COLUMN     "imageX" DOUBLE PRECISION,
ADD COLUMN     "imageY" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ComparisonOption" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "mediaId" UUID,

    CONSTRAINT "ComparisonOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComparisonOption_questionId_idx" ON "ComparisonOption"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonOption_questionId_position_key" ON "ComparisonOption"("questionId", "position");

-- AddForeignKey
ALTER TABLE "ComparisonOption" ADD CONSTRAINT "ComparisonOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonOption" ADD CONSTRAINT "ComparisonOption_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
