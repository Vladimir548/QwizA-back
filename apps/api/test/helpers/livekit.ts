import { ConfigService } from "@nestjs/config";
import { LivekitService } from "../../src/rooms/livekit.service";

export const livekitTestKey = "test-key";
export const livekitTestSecret = "test-secret-at-least-thirty-two-characters";

export function testLivekit() {
  const disconnected: string[] = [];
  const service = new LivekitService(
    new ConfigService({
      LIVEKIT_URL: "wss://media.example.test",
      LIVEKIT_API_KEY: livekitTestKey,
      LIVEKIT_API_SECRET: livekitTestSecret,
    }),
  );
  service.disconnect = async (roomId, identity) => {
    disconnected.push(`${roomId}/${identity}`);
  };
  return { service, disconnected };
}
