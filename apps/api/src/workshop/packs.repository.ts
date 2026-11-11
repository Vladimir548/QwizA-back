import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { WorkshopPack } from "./workshop.model";

const packInclude = {
  author: { select: { id: true, displayName: true } },
  cover: true,
  topics: {
    orderBy: { position: "asc" },
    include: {
      questions: {
        orderBy: { position: "asc" },
        include: {
          questionMedia: true,
          differenceMedia: true,
          answerMedia: true,
          geoMapMedia: true,
          choices: { orderBy: { position: "asc" } },
          comparisonOptions: { orderBy: { position: "asc" }, include: { media: true } },
        },
      },
    },
  },
} as const satisfies Prisma.PackInclude;

type PackRecord = Prisma.PackGetPayload<{ include: typeof packInclude }>;

function toWorkshopPack(record: PackRecord): WorkshopPack {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    published: record.published,
    status: record.status as WorkshopPack["status"],
    revision: record.revision,
    author: record.author ? { id: record.author.id, name: record.author.displayName } : undefined,
    isOfficial: record.isOfficial,
    cover: record.cover ? { id: record.cover.id, kind: "image" } : undefined,
    submittedAt: record.submittedAt?.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString(),
    rejectionReason: record.rejectionReason ?? undefined,
    rounds: record.rounds,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    topics: record.topics.map((topic) => ({
      id: topic.id,
      isFinal: topic.isFinal,
      roundIndex: topic.roundIndex,
      title: topic.title,
      ordered: topic.ordered,
      direction: topic.direction,
      questions: topic.questions.map((question) => ({
        id: question.id,
        type:
          question.type === "image_point"
            ? "image-point"
            : question.type === "numeric_closest"
              ? "numeric-closest"
              : question.type === "spot_difference"
                ? "spot-difference"
                : question.type === "video_prediction"
                  ? "video-prediction"
                  : question.type,
        answerMode: question.answerMode,
        answerTimeSeconds: question.answerTimeSeconds,
        value: question.value,
        promptText: question.promptText,
        answerText: question.answerText,
        acceptedAnswers: question.acceptedAnswers,
        questionMedia: question.questionMedia
          ? {
              id: question.questionMedia.id,
              kind: question.questionMedia.kind,
              durationSeconds: question.questionMedia.durationSeconds ?? undefined,
            }
          : undefined,
        answerMedia: question.answerMedia
          ? { id: question.answerMedia.id, kind: question.answerMedia.kind }
          : undefined,
        choices: question.choices.map((choice) => choice.text),
        correctChoiceIndex: question.choices.find((choice) => choice.isCorrect)?.position ?? null,
        geoMapMode: question.type === "geo" ? (question.geoMapMode ?? "world") : undefined,
        geoMapMedia: question.geoMapMedia
          ? { id: question.geoMapMedia.id, kind: question.geoMapMedia.kind }
          : undefined,
        geoTarget:
          question.geoLat != null && question.geoLng != null
            ? { lat: question.geoLat, lng: question.geoLng }
            : undefined,
        geoToleranceKm: question.geoToleranceKm ?? undefined,
        imageTarget:
          question.imageX != null && question.imageY != null
            ? { x: question.imageX, y: question.imageY }
            : undefined,
        imageTolerancePercent: question.imageTolerancePercent ?? undefined,
        numericTarget: question.numericTarget ?? undefined,
        numericUnit: question.numericUnit ?? undefined,
        puzzleGridSize: question.puzzleGridSize ?? undefined,
        differenceMedia: question.differenceMedia
          ? { id: question.differenceMedia.id, kind: question.differenceMedia.kind }
          : undefined,
        differenceTargets: question.differenceTargets as { x: number; y: number }[] | undefined,
        differenceTolerancePercent: question.differenceTolerancePercent ?? undefined,
        matchingPairs: question.matchingPairs as
          | {
              element: string;
              fact: string;
              media?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
            }[]
          | undefined,
        videoStopSeconds: question.videoStopSeconds ?? undefined,
        comparisonUnit: question.comparisonUnit ?? undefined,
        comparisonOptions: question.comparisonOptions.map((option) => ({
          id: option.id,
          label: option.label,
          amount: option.amount,
          media: option.media ? { id: option.media.id, kind: option.media.kind } : undefined,
        })),
      })),
    })),
  };
}

function nestedTopics(pack: WorkshopPack) {
  return pack.topics.map((topic, position) => ({
    id: topic.id,
    position,
    isFinal: topic.isFinal,
    roundIndex: topic.roundIndex,
    title: topic.title,
    ordered: topic.ordered,
    direction: topic.direction,
    questions: {
      create: topic.questions.map((question, questionPosition) => ({
        id: question.id,
        position: questionPosition,
        type:
          question.type === "image-point"
            ? ("image_point" as const)
            : question.type === "numeric-closest"
              ? ("numeric_closest" as const)
              : question.type === "spot-difference"
                ? ("spot_difference" as const)
                : question.type === "video-prediction"
                  ? ("video_prediction" as const)
                  : question.type,
        answerMode: question.answerMode,
        answerTimeSeconds: question.answerTimeSeconds,
        value: question.value,
        promptText: question.promptText,
        answerText: question.answerText,
        acceptedAnswers: question.acceptedAnswers,
        geoMapMode: question.geoMapMode,
        geoLat: question.geoTarget?.lat,
        geoLng: question.geoTarget?.lng,
        geoToleranceKm: question.geoToleranceKm,
        imageX: question.imageTarget?.x,
        imageY: question.imageTarget?.y,
        imageTolerancePercent: question.imageTolerancePercent,
        numericTarget: question.numericTarget,
        numericUnit: question.numericUnit,
        puzzleGridSize: question.puzzleGridSize,
        differenceTargets:
          question.differenceTargets?.map((point) => ({ x: point.x, y: point.y })) ?? undefined,
        differenceTolerancePercent: question.differenceTolerancePercent,
        matchingPairs: question.matchingPairs
          ? (question.matchingPairs.map((pair) => ({
              element: pair.element,
              fact: pair.fact,
              ...(pair.media
                ? {
                    media: {
                      id: pair.media.id,
                      kind: pair.media.kind,
                      ...(pair.media.durationSeconds !== undefined
                        ? { durationSeconds: pair.media.durationSeconds }
                        : {}),
                    },
                  }
                : {}),
            })) as Prisma.InputJsonValue)
          : undefined,
        videoStopSeconds: question.videoStopSeconds,
        comparisonUnit: question.comparisonUnit,
        questionMedia: question.questionMedia
          ? { connect: { id: question.questionMedia.id } }
          : undefined,
        differenceMedia: question.differenceMedia
          ? { connect: { id: question.differenceMedia.id } }
          : undefined,
        answerMedia: question.answerMedia
          ? { connect: { id: question.answerMedia.id } }
          : undefined,
        geoMapMedia: question.geoMapMedia
          ? { connect: { id: question.geoMapMedia.id } }
          : undefined,
        choices: {
          create: question.choices.map((text, choicePosition) => ({
            position: choicePosition,
            text,
            isCorrect: choicePosition === question.correctChoiceIndex,
          })),
        },
        comparisonOptions: {
          create: (question.comparisonOptions ?? []).map((option, optionPosition) => ({
            id: option.id,
            position: optionPosition,
            label: option.label,
            amount: option.amount,
            media: option.media ? { connect: { id: option.media.id } } : undefined,
          })),
        },
      })),
    },
  }));
}

@Injectable()
export class PacksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(where: Prisma.PackWhereInput = {}): Promise<WorkshopPack[]> {
    const records = await this.prisma.pack.findMany({
      where,
      include: packInclude,
      orderBy: { updatedAt: "desc" },
    });
    return records.map(toWorkshopPack);
  }

  async listPublished(): Promise<WorkshopPack[]> {
    const records = await this.prisma.pack.findMany({
      where: { published: true, status: "approved" },
      include: packInclude,
      orderBy: { updatedAt: "desc" },
    });
    return records.map(toWorkshopPack);
  }

  async find(id: string): Promise<WorkshopPack | undefined> {
    const record = await this.prisma.pack.findUnique({ where: { id }, include: packInclude });
    return record ? toWorkshopPack(record) : undefined;
  }

  async save(pack: WorkshopPack): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const exists = await transaction.pack.findUnique({
        where: { id: pack.id },
        select: { id: true },
      });
      if (exists) {
        await transaction.topic.deleteMany({ where: { packId: pack.id } });
        await transaction.pack.update({
          where: { id: pack.id },
          data: {
            title: pack.title,
            description: pack.description,
            published: pack.published,
            status: pack.status ?? "draft",
            revision: { increment: 1 },
            authorId: pack.author?.id,
            isOfficial: pack.isOfficial ?? false,
            coverId: pack.cover?.id ?? null,
            submittedAt: null,
            reviewedAt: null,
            reviewedById: null,
            rejectionReason: null,
            rounds: pack.rounds,
            updatedAt: new Date(pack.updatedAt),
            topics: { create: nestedTopics(pack) },
          },
        });
      } else {
        await transaction.pack.create({
          data: {
            id: pack.id,
            title: pack.title,
            description: pack.description,
            published: pack.published,
            status: pack.status ?? "draft",
            authorId: pack.author?.id,
            isOfficial: pack.isOfficial ?? false,
            coverId: pack.cover?.id,
            rounds: pack.rounds,
            createdAt: new Date(pack.createdAt),
            updatedAt: new Date(pack.updatedAt),
            topics: { create: nestedTopics(pack) },
          },
        });
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.pack.delete({ where: { id } });
  }

  async setPublished(id: string, published: boolean): Promise<void> {
    await this.prisma.pack.update({
      where: { id },
      data: { published, status: published ? "approved" : "draft" },
    });
  }

  async transition(
    id: string,
    revision: number,
    status: string,
    data: Prisma.PackUncheckedUpdateManyInput,
  ) {
    const changed = await this.prisma.pack.updateMany({
      where: { id, revision, status },
      data: { ...data, revision: { increment: 1 } },
    });
    return changed.count === 1;
  }
}
