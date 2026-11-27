import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { Module, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { validateEnvironment } from "../apps/api/dist/config/environment.js";
import { PrismaModule } from "../apps/api/dist/prisma/prisma.module.js";
import { PackDto } from "../apps/api/dist/workshop/dto/pack.dto.js";
import { PacksRepository } from "../apps/api/dist/workshop/packs.repository.js";
import { PacksService } from "../apps/api/dist/workshop/packs.service.js";
import { WorkshopModule } from "../apps/api/dist/workshop/workshop.module.js";
import { culture } from "./quiz-packs/culture.mjs";
import { expandPackRounds, extraTopics } from "./quiz-packs/extra-topics.mjs";
import { geography } from "./quiz-packs/geography.mjs";
import { toPackDraft } from "./quiz-packs/questions.mjs";
import { science } from "./quiz-packs/science.mjs";

process.loadEnvFile(fileURLToPath(new URL("../apps/api/.env", import.meta.url)));
const database = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) {
  throw new Error("Эти черновики можно добавить только в локальную базу");
}

class QuizPackSeedModule {}
Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnvironment }),
    PrismaModule,
    WorkshopModule,
  ],
})(QuizPackSeedModule);

const app = await NestFactory.createApplicationContext(QuizPackSeedModule, { logger: false });
try {
  const packs = app.get(PacksService);
  const repository = app.get(PacksRepository);
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const expandExisting = process.argv.includes("--expand-existing");
  const content = [geography, science, culture];
  const existingPacks = await repository.list({
    authorId: null,
    title: { in: content.map(({ title }) => title) },
  });
  const plans = [];
  for (const pack of content) {
    const draft = toPackDraft(expandPackRounds(pack));
    const existing = existingPacks.find((entry) => entry.title === draft.title);
    if (existing && !expandExisting) {
      console.log(`${existing.title} | ${existing.status} | ${existing.id}`);
      continue;
    }

    let added = 0;
    const topics =
      existing?.topics.map((topic) => {
        if (topic.isFinal) return topic;
        const oldExtra = extraTopics[draft.title][topic.roundIndex]?.find(
          ([title]) => title === topic.title,
        );
        if (!oldExtra) return topic;
        const complete = draft.topics.find(
          (candidate) =>
            candidate.title === topic.title && candidate.roundIndex === topic.roundIndex,
        );
        const existingPrompts = new Set(topic.questions.map(({ promptText }) => promptText));
        const additions = complete.questions
          .slice(oldExtra[1].length)
          .filter(({ promptText }) => !existingPrompts.has(promptText));
        added += additions.length;
        return { ...topic, questions: [...topic.questions, ...additions] };
      }) ?? draft.topics;

    const rounds = existing?.rounds ?? draft.rounds;
    if (
      rounds.length !== 2 ||
      rounds.some(
        (_, index) =>
          topics.filter((topic) => !topic.isFinal && topic.roundIndex === index).length !== 6,
      ) ||
      topics.some((topic) => topic.questions.length !== (topic.isFinal ? 1 : 10))
    ) {
      throw new Error(
        `${draft.title}: ожидаются шесть тем по десять вопросов в каждом из двух раундов`,
      );
    }
    if (existing && added === 0) {
      console.log(`${existing.title} | вопросы уже добавлены | ${existing.id}`);
      continue;
    }

    const input = await pipe.transform(
      {
        ...draft,
        cover: existing?.cover,
        description: existing?.description ?? draft.description,
        revision: existing?.revision,
        rounds,
        topics,
      },
      { type: "body", metatype: PackDto },
    );
    const report = await packs.check(input);
    if (!report.valid) throw new Error(`${draft.title}: ${JSON.stringify(report.errors)}`);
    plans.push({ existing, input, added });
  }

  for (const { existing, input, added } of plans) {
    const saved = existing ? await packs.update(existing.id, input) : await packs.create(input);
    if (saved.status === "pending") {
      const returnedToDraft = await repository.transition(saved.id, saved.revision, "pending", {
        status: "draft",
        published: false,
        submittedAt: null,
        reviewedAt: null,
        reviewedById: null,
        rejectionReason: null,
      });
      if (!returnedToDraft) throw new Error(`Статус пака «${saved.title}» уже изменился`);
    }
    console.log(
      `${saved.title} | черновик | ${saved.id}${added ? ` | добавлено вопросов: ${added}` : ""}`,
    );
  }
} finally {
  await app.close();
}
