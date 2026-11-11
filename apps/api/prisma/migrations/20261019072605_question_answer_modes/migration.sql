-- CreateEnum
CREATE TYPE "AnswerMode" AS ENUM ('buzzer', 'everyone');

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "answerMode" "AnswerMode" NOT NULL DEFAULT 'buzzer',
ADD COLUMN     "answerTimeSeconds" INTEGER NOT NULL DEFAULT 30;
