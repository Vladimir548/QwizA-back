-- Preserve legacy emails and account IDs; new accounts only need a nickname.
ALTER TABLE "UserAccount" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "UserAccount" ADD COLUMN "nicknameKey" VARCHAR(80);

-- Older accounts may share a display name. Keep the oldest spelling and add a
-- stable suffix to duplicates, without touching sessions or game history.
DO $$
DECLARE
  account RECORD;
  base_name TEXT;
  candidate TEXT;
  suffix TEXT;
  attempt INTEGER;
BEGIN
  FOR account IN SELECT id, "displayName" FROM "UserAccount" ORDER BY "createdAt", id LOOP
    base_name := COALESCE(NULLIF(btrim(account."displayName"), ''), 'Player');
    candidate := base_name;
    attempt := 0;
    WHILE EXISTS (SELECT 1 FROM "UserAccount" WHERE "nicknameKey" = lower(candidate)) LOOP
      attempt := attempt + 1;
      suffix := '-' || left(account.id::text, 8) || CASE WHEN attempt > 1 THEN '-' || attempt::text ELSE '' END;
      candidate := left(base_name, 40 - length(suffix)) || suffix;
    END LOOP;
    UPDATE "UserAccount" SET "displayName" = candidate, "nicknameKey" = lower(candidate) WHERE id = account.id;
  END LOOP;
END $$;

ALTER TABLE "UserAccount" ALTER COLUMN "nicknameKey" SET NOT NULL;
CREATE UNIQUE INDEX "UserAccount_nicknameKey_key" ON "UserAccount"("nicknameKey");
