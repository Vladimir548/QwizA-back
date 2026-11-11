import type { INestApplication } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";

type SocketOptions = NonNullable<Parameters<IoAdapter["createIOServer"]>[1]>;

export class AppSocketIoAdapter extends IoAdapter {
  private readonly origins: string[];

  constructor(app: INestApplication, origin: string) {
    super(app.getHttpAdapter().getHttpServer());
    this.origins = [origin, "http://localhost:3000", "http://127.0.0.1:3000"];
  }

  override createIOServer(
    port: number,
    options?: SocketOptions,
  ): ReturnType<IoAdapter["createIOServer"]> {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
      allowRequest: (request, callback) =>
        callback(null, !request.headers.origin || this.origins.includes(request.headers.origin)),
    } as SocketOptions);
  }
}
