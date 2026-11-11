ALTER TABLE "GameRoom" ADD COLUMN "teamCount" INTEGER NOT NULL DEFAULT 1;
UPDATE "GameRoom" SET "teamCount" = 2 WHERE "gameMode" = 'team';
