import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MinigamesModule } from "./minigames.module";

// Optional local launcher: the in-memory minigames need no database connection.
async function bootstrap() {
  const app = await NestFactory.create(MinigamesModule);
  app.setGlobalPrefix("api");
  app.enableCors({ origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), "127.0.0.1");
}
void bootstrap().catch((error: unknown) => {
  Logger.error(error, "Minigames");
  process.exitCode = 1;
});
