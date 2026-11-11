import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { MediaRef } from "./workshop.model";

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(ref: MediaRef, byteSize: number) {
    await this.prisma.mediaAsset.create({
      data: {
        id: ref.id,
        kind: ref.kind,
        mimeType:
          ref.kind === "image" ? "image/webp" : ref.kind === "audio" ? "audio/mpeg" : "video/mp4",
        byteSize,
        durationSeconds: ref.durationSeconds,
      },
    });
  }

  async exists(ref: MediaRef) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: ref.id },
      select: { kind: true },
    });
    return asset?.kind === ref.kind;
  }

  async find(ref: MediaRef): Promise<MediaRef | undefined> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: ref.id },
      select: { id: true, kind: true, durationSeconds: true },
    });
    return asset?.kind === ref.kind
      ? { id: asset.id, kind: asset.kind, durationSeconds: asset.durationSeconds ?? undefined }
      : undefined;
  }
}
