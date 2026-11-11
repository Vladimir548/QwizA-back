export function validateEnvironment(env: Record<string, unknown>) {
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  const origin = String(env.WEB_ORIGIN ?? "http://localhost:3000");
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
    throw new Error("WEB_ORIGIN must be an HTTP origin without a path");
  const imageMaxBytes = Number(env.MEDIA_IMAGE_MAX_BYTES ?? 3 * 1024 * 1024);
  const videoMaxBytes = Number(env.MEDIA_VIDEO_MAX_BYTES ?? 100 * 1024 * 1024);
  const audioMaxBytes = Number(env.MEDIA_AUDIO_MAX_BYTES ?? 20 * 1024 * 1024);
  if (!Number.isSafeInteger(imageMaxBytes) || imageMaxBytes < 1)
    throw new Error("MEDIA_IMAGE_MAX_BYTES must be a positive integer");
  if (!Number.isSafeInteger(videoMaxBytes) || videoMaxBytes < 1)
    throw new Error("MEDIA_VIDEO_MAX_BYTES must be a positive integer");
  if (!Number.isSafeInteger(audioMaxBytes) || audioMaxBytes < 1)
    throw new Error("MEDIA_AUDIO_MAX_BYTES must be a positive integer");
  const databaseUrl = String(env.DATABASE_URL ?? "");
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  if (
    !["postgresql:", "postgres:"].includes(database.protocol) ||
    !database.hostname ||
    !database.pathname ||
    database.pathname === "/"
  ) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  return {
    ...env,
    PORT: port,
    HOST: String(env.HOST ?? "127.0.0.1"),
    WEB_ORIGIN: origin,
    MEDIA_IMAGE_MAX_BYTES: imageMaxBytes,
    MEDIA_VIDEO_MAX_BYTES: videoMaxBytes,
    MEDIA_AUDIO_MAX_BYTES: audioMaxBytes,
    DATABASE_URL: databaseUrl,
  };
}
