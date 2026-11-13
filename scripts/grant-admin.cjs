const { config } = require("dotenv");
const { join } = require("node:path");
const { Client } = require("pg");
config({ path: join(__dirname, "../apps/api/.env"), quiet: true });

async function main() {
  const login = process.argv[2]?.trim().toLowerCase();
  if (!login || login.length > 254 || /\p{C}/u.test(login))
    throw new Error(
      "Укажи ник существующего аккаунта: node scripts/grant-admin.cjs PlayerNickname",
    );
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    let account = await client.query('SELECT "id" FROM "UserAccount" WHERE "nicknameKey" = $1', [
      login,
    ]);
    if (!account.rowCount && login.includes("@"))
      account = await client.query('SELECT "id" FROM "UserAccount" WHERE "email" = $1', [login]);
    if (account.rowCount !== 1)
      throw new Error("Аккаунт не найден. Сначала зарегистрируй его в приложении");
    await client.query('UPDATE "UserAccount" SET "role" = $1 WHERE "id" = $2', [
      "admin",
      account.rows[0].id,
    ]);
    console.log("Аккаунту назначена роль администратора. Раздел проверки: /admin/packs");
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
