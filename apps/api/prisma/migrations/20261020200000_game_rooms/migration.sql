CREATE TABLE "GameRoom" (
  "id" UUID NOT NULL PRIMARY KEY,
  "code" VARCHAR(8) NOT NULL UNIQUE,
  "name" VARCHAR(100) NOT NULL,
  "packId" UUID,
  "gameMode" VARCHAR(10) NOT NULL,
  "maxPlayers" INTEGER NOT NULL,
  "creatorId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL,
  "pack" JSONB NOT NULL,
  "deadlineAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GameRoom_deadlineAt_idx" ON "GameRoom"("deadlineAt");

CREATE TABLE "GameParticipant" (
  "id" UUID NOT NULL PRIMARY KEY,
  "roomId" UUID NOT NULL REFERENCES "GameRoom"("id") ON DELETE CASCADE,
  "tokenHash" CHAR(64) NOT NULL UNIQUE,
  "name" VARCHAR(40) NOT NULL,
  "role" VARCHAR(10) NOT NULL,
  "teamId" VARCHAR(20),
  "score" INTEGER NOT NULL DEFAULT 0,
  "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GameParticipant_roomId_idx" ON "GameParticipant"("roomId");

CREATE TABLE "GameCommand" (
  "id" UUID NOT NULL PRIMARY KEY,
  "roomId" UUID NOT NULL REFERENCES "GameRoom"("id") ON DELETE CASCADE,
  "participantId" UUID NOT NULL REFERENCES "GameParticipant"("id") ON DELETE CASCADE,
  "commandId" VARCHAR(80) NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameCommand_roomId_participantId_commandId_key" UNIQUE ("roomId", "participantId", "commandId")
);
CREATE INDEX "GameCommand_roomId_createdAt_idx" ON "GameCommand"("roomId", "createdAt");

CREATE TABLE "GameRoomEvent" (
  "id" UUID NOT NULL PRIMARY KEY,
  "roomId" UUID NOT NULL REFERENCES "GameRoom"("id") ON DELETE CASCADE,
  "revision" INTEGER NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameRoomEvent_roomId_revision_key" UNIQUE ("roomId", "revision")
);
