ALTER TABLE "GameParticipant" ADD COLUMN "seatNumber" INTEGER;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "roomId", "teamId"
    ORDER BY "joinedAt", "id"
  ) AS seat
  FROM "GameParticipant"
  WHERE "role" = 'player'
)
UPDATE "GameParticipant" AS participant
SET "seatNumber" = numbered.seat
FROM numbered
WHERE participant."id" = numbered."id";

CREATE UNIQUE INDEX "GameParticipant_roomId_teamId_seatNumber_key"
  ON "GameParticipant"("roomId", "teamId", "seatNumber")
  WHERE "teamId" IS NOT NULL;

CREATE UNIQUE INDEX "GameParticipant_roomId_soloSeat_key"
  ON "GameParticipant"("roomId", "seatNumber")
  WHERE "teamId" IS NULL AND "role" = 'player';
