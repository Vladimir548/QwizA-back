ALTER TYPE "QuestionKind" ADD VALUE 'numeric_closest';
ALTER TYPE "QuestionKind" ADD VALUE 'puzzle';
ALTER TYPE "QuestionKind" ADD VALUE 'spot_difference';

ALTER TABLE "Question"
  ADD COLUMN "differenceMediaId" UUID,
  ADD COLUMN "numericTarget" DOUBLE PRECISION,
  ADD COLUMN "numericUnit" VARCHAR(30),
  ADD COLUMN "puzzleGridSize" INTEGER,
  ADD COLUMN "differenceTargets" JSONB,
  ADD COLUMN "differenceTolerancePercent" DOUBLE PRECISION;

ALTER TABLE "Question" ADD CONSTRAINT "Question_differenceMediaId_fkey"
  FOREIGN KEY ("differenceMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
