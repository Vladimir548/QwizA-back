import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccessToken, RoomServiceClient, TrackSource, TwirpError } from "livekit-server-sdk";
import { playerMediaIdentity, type PlayerMediaConnection } from "@qwiza/minigames";

@Injectable()
export class LivekitService {
  constructor(private readonly config: ConfigService) {}

  async connection(
    roomId: string,
    participantId: string,
    connectionId: string,
    canPublish: boolean,
  ): Promise<PlayerMediaConnection> {
    const { url, key, secret } = this.settings();
    const token = new AccessToken(key, secret, {
      identity: playerMediaIdentity(participantId, connectionId),
      ttl: "2m",
      metadata: JSON.stringify({ connectionId }),
    });
    token.addGrant({
      room: this.roomName(roomId),
      roomJoin: true,
      canSubscribe: true,
      canPublish,
      canPublishData: false,
      canPublishSources: canPublish ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [],
    });
    return { url, token: await token.toJwt() };
  }

  async disconnect(roomId: string, participantId: string) {
    if (!this.config.get<string>("LIVEKIT_URL")) return;
    const { url, key, secret } = this.settings();
    const httpUrl = this.config.get<string>("LIVEKIT_API_URL") ?? url.replace(/^ws/, "http");
    try {
      await new RoomServiceClient(httpUrl, key, secret).removeParticipant(
        this.roomName(roomId),
        participantId,
      );
    } catch (error) {
      if (!(error instanceof TwirpError && error.code === "not_found")) throw error;
    }
  }

  private roomName(roomId: string) {
    return `qwiza-${roomId}`;
  }

  private settings() {
    const url = this.config.get<string>("LIVEKIT_URL");
    const key = this.config.get<string>("LIVEKIT_API_KEY");
    const secret = this.config.get<string>("LIVEKIT_API_SECRET");
    if (!url || !key || !secret)
      throw new ServiceUnavailableException("Видеосервер ещё не настроен");
    return { url, key, secret };
  }
}
