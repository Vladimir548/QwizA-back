ALTER TYPE "MediaKind" ADD VALUE 'audio';
ALTER TABLE "MediaAsset" ADD COLUMN "durationSeconds" DOUBLE PRECISION;
