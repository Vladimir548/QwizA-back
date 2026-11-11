import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger, ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AppSocketIoAdapter } from "./config/socket-io-adapter";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.useWebSocketAdapter(new AppSocketIoAdapter(app, config.getOrThrow<string>("WEB_ORIGIN")));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: [
      config.getOrThrow<string>("WEB_ORIGIN"),
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    ],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  const port = config.getOrThrow<number>("PORT");
  const host = config.getOrThrow<string>("HOST");
  await app.listen(port, host);
  Logger.log(`API listening at http://${host}:${port}/api/health`, "Bootstrap");
}
void bootstrap().catch((error: unknown) => {
  Logger.error(error, "Bootstrap");
  process.exitCode = 1;
});
