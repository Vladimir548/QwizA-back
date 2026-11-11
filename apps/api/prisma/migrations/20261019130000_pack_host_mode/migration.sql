CREATE TYPE "PackHostMode" AS ENUM ('with_host', 'without_host');
ALTER TABLE "Pack" ADD COLUMN "hostMode" "PackHostMode" NOT NULL DEFAULT 'without_host';
