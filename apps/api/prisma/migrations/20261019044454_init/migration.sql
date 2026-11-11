-- CreateEnum
CREATE TYPE "TopicDirection" AS ENUM ('forward', 'reverse');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('text', 'choice');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('image', 'video');

-- CreateTable
CREATE TABLE "Pack" (
    "id" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "ordered" BOOLEAN NOT NULL DEFAULT false,
    "direction" "TopicDirection" NOT NULL DEFAULT 'forward',

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "topicId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "QuestionKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "promptText" VARCHAR(1000) NOT NULL,
    "answerText" VARCHAR(300) NOT NULL,
    "questionMediaId" UUID,
    "answerMediaId" UUID,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChoiceOption" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChoiceOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "mimeType" VARCHAR(30) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Topic_packId_idx" ON "Topic"("packId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_packId_position_key" ON "Topic"("packId", "position");

-- CreateIndex
CREATE INDEX "Question_topicId_idx" ON "Question"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_topicId_position_key" ON "Question"("topicId", "position");

-- CreateIndex
CREATE INDEX "ChoiceOption_questionId_idx" ON "ChoiceOption"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ChoiceOption_questionId_position_key" ON "ChoiceOption"("questionId", "position");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_questionMediaId_fkey" FOREIGN KEY ("questionMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_answerMediaId_fkey" FOREIGN KEY ("answerMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoiceOption" ADD CONSTRAINT "ChoiceOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
