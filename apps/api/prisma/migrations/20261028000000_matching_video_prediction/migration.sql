ALTER TYPE "QuestionKind" ADD VALUE 'matching';
ALTER TYPE "QuestionKind" ADD VALUE 'video_prediction';
ALTER TABLE "Question" ADD COLUMN "matchingPairs" JSONB;
ALTER TABLE "Question" ADD COLUMN "videoStopSeconds" DOUBLE PRECISION;
