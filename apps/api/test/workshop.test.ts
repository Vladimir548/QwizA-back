import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { MediaService } from "../src/workshop/media.service";
import { MediaRepository } from "../src/workshop/media.repository";
import { PacksRepository } from "../src/workshop/packs.repository";
import { PacksService } from "../src/workshop/packs.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { PackDto } from "../src/workshop/dto/pack.dto";

const config = new ConfigService({
  MEDIA_IMAGE_MAX_BYTES: 3 * 1024 * 1024,
  MEDIA_VIDEO_MAX_BYTES: 20 * 1024 * 1024,
  MEDIA_AUDIO_MAX_BYTES: 20 * 1024 * 1024,
});
const runFile = promisify(execFile);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

async function testServices() {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for workshop tests");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: testDatabaseUrl }));
  await prisma.$connect();
  const repository = new PacksRepository(prisma);
  const media = new MediaService(config, new MediaRepository(prisma));
  return { prisma, repository, media, packs: new PacksService(repository, media) };
}
const draft = (): PackDto => ({
  title: "Музыка и мир",
  description: "Квиз для друзей",
  topics: [
    {
      title: "Музыка",
      ordered: true,
      direction: "reverse",
      questions: [
        {
          type: "choice",
          answerMode: "everyone",
          answerTimeSeconds: 45,
          value: 100,
          promptText: "Кто поёт?",
          answerText: "",
          choices: ["А", "Б"],
          correctChoiceIndex: 1,
        },
      ],
    },
  ],
});

test("a topic accepts at most ten questions", async () => {
  const input = draft();
  input.topics[0].questions = Array.from({ length: 10 }, () => ({
    ...input.topics[0].questions[0],
  }));
  assert.deepEqual(await validate(plainToInstance(PackDto, input)), []);
  input.topics[0].questions.push({ ...input.topics[0].questions[0] });
  assert.match(JSON.stringify(await validate(plainToInstance(PackDto, input))), /arrayMaxSize/);
});

test("question answer time stays within 15–60 seconds", async () => {
  const input = draft();
  input.topics[0].questions[0].answerTimeSeconds = 14;
  assert.match(JSON.stringify(await validate(plainToInstance(PackDto, input))), /min/);
  input.topics[0].questions[0].answerTimeSeconds = 61;
  assert.match(JSON.stringify(await validate(plainToInstance(PackDto, input))), /max/);
  input.topics[0].questions[0].answerTimeSeconds = 30;
  assert.deepEqual(await validate(plainToInstance(PackDto, input)), []);
});

test("text answer variants are validated and persist with the question", async () => {
  const { prisma, packs, repository } = await testServices();
  let packId: string | undefined;
  try {
    const input = draft();
    input.topics[0].questions[0] = {
      ...input.topics[0].questions[0],
      type: "text",
      answerText: "Пётр I",
      acceptedAnswers: [" Пётр Первый ", "Пётр Первый", "Пётр 1", " "],
    };
    const saved = await packs.create(input);
    packId = saved.id;
    assert.deepEqual(saved.topics[0].questions[0].acceptedAnswers, ["Пётр Первый", "Пётр 1"]);
    assert.deepEqual((await repository.find(saved.id))?.topics[0].questions[0].acceptedAnswers, [
      "Пётр Первый",
      "Пётр 1",
    ]);
    input.topics[0].questions[0].acceptedAnswers = Array(11).fill("вариант");
    assert.match(JSON.stringify(await validate(plainToInstance(PackDto, input))), /arrayMaxSize/);
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    await prisma.$disconnect();
  }
});

test("matching pairs are validated and survive a pack roundtrip", async () => {
  const { prisma, packs, repository } = await testServices();
  let packId: string | undefined;
  try {
    const input = draft();
    input.topics[0].questions[0] = {
      ...input.topics[0].questions[0],
      type: "matching",
      promptText: "Соотнеси животных с фактами",
      matchingPairs: [
        { element: "Лиса", fact: "Рыжая" },
        { element: "Слон", fact: "Большой" },
      ],
    };
    const saved = await packs.create(input);
    packId = saved.id;
    assert.deepEqual((await repository.find(saved.id))?.topics[0].questions[0].matchingPairs, [
      { element: "Лиса", fact: "Рыжая" },
      { element: "Слон", fact: "Большой" },
    ]);
    input.topics[0].questions[0].matchingPairs![1].fact = "Рыжая";
    await assert.rejects(() => packs.update(saved.id, input), /уникальных/);
    input.topics[0].questions[0].matchingPairs![1].fact = "Большой";
    input.topics[0].questions[0].matchingPairs![0].fact = "а".repeat(121);
    await assert.rejects(() => packs.update(saved.id, input), /120 символов/);
    input.topics[0].questions[0].matchingPairs![0].fact = "Рыжая";
    input.topics[0].questions[0].matchingPairs!.push(
      { element: "Зебра", fact: "Полосатая" },
      { element: "Кот", fact: "Мурлычет" },
      { element: "Пёс", fact: "Лает" },
    );
    await assert.rejects(() => packs.update(saved.id, input), /от 2 до 4/);
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    await prisma.$disconnect();
  }
});

test("a pack can be published and removed from the store", async () => {
  const { prisma, packs } = await testServices();
  let packId: string | undefined;
  try {
    const saved = await packs.create(draft());
    packId = saved.id;
    assert.equal(saved.published, false);
    assert.equal(
      (await packs.store()).some((pack) => pack.id === saved.id),
      false,
    );
    const published = await packs.setPublished(saved.id, true);
    assert.equal(published.published, true);
    assert.equal(
      (await packs.store()).some((pack) => pack.id === saved.id),
      true,
    );
    assert.equal(
      (await packs.update(saved.id, { ...draft(), title: "Новое название" })).published,
      false,
    );
    assert.equal((await packs.get(saved.id)).status, "draft");
    await packs.setPublished(saved.id, false);
    assert.equal(
      (await packs.store()).some((pack) => pack.id === saved.id),
      false,
    );
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    await prisma.$disconnect();
  }
});

test("round assignments persist and invalid assignments are rejected", async () => {
  const { prisma, packs, repository } = await testServices();
  let packId: string | undefined;
  try {
    const input = draft();
    input.rounds = ["Разминка", "Финал"];
    input.topics[0].roundIndex = 1;
    const saved = await packs.create(input);
    packId = saved.id;
    const reloaded = await repository.find(saved.id);
    assert.deepEqual(reloaded?.rounds, ["Разминка", "Финал"]);
    assert.equal(reloaded?.topics[0].roundIndex, 1);
    input.topics[0].roundIndex = 2;
    await assert.rejects(() => packs.update(saved.id, input), /несуществующему раунду/);
    input.topics = Array.from({ length: 7 }, (_, index) => ({
      ...input.topics[0],
      title: `Тема ${index + 1}`,
      roundIndex: index === 6 ? 1 : 0,
    }));
    await packs.update(saved.id, input);
    input.topics[6].roundIndex = 0;
    await assert.rejects(() => packs.update(saved.id, input), /не больше шести тем/);
    input.rounds = ["1", "2", "3", "4", "5", "6"];
    assert.match(JSON.stringify(await validate(plainToInstance(PackDto, input))), /arrayMaxSize/);
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    await prisma.$disconnect();
  }
});

test("pack rules and PostgreSQL persistence", async () => {
  const { prisma, repository, packs } = await testServices();
  let packId: string | undefined;
  try {
    const saved = await packs.create(draft());
    packId = saved.id;
    assert.equal(saved.published, false);
    assert.equal(saved.topics[0].direction, "reverse");
    assert.equal(saved.topics[0].questions[0].choices[1], "Б");
    assert.equal(saved.topics[0].questions[0].answerMode, "everyone");
    assert.equal(saved.topics[0].questions[0].answerTimeSeconds, 45);
    const reloaded = await repository.find(saved.id);
    assert.equal(reloaded?.title, "Музыка и мир");
    assert.equal(reloaded?.topics[0].questions[0].correctChoiceIndex, 1);
    assert.equal(reloaded?.topics[0].questions[0].answerMode, "everyone");
    assert.equal(reloaded?.topics[0].questions[0].answerTimeSeconds, 45);
    assert.equal(
      (await packs.list()).some((pack) => pack.id === saved.id),
      true,
    );

    const unordered = draft();
    unordered.topics[0].ordered = false;
    const updated = await packs.update(saved.id, unordered);
    assert.equal(updated.topics[0].direction, "forward");
    assert.equal((await repository.find(saved.id))?.topics[0].direction, "forward");

    const invalid = draft();
    invalid.topics[0].questions[0].correctChoiceIndex = 2;
    await assert.rejects(() => packs.create(invalid), /правильный вариант/);
    invalid.topics[0].questions[0].correctChoiceIndex = 0;
    invalid.topics[0].questions[0].promptText = "";
    await assert.rejects(() => packs.create(invalid), /текст или медиа/);

    await packs.remove(saved.id);
    packId = undefined;
    assert.equal(await repository.find(saved.id), undefined);
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    await prisma.$disconnect();
  }
});

test("interactive question settings and comparison images survive PostgreSQL roundtrip", async () => {
  const previous = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "qwiza-interactive-test-"));
  process.chdir(directory);
  const { prisma, media, packs, repository } = await testServices();
  let packId: string | undefined;
  let mediaId: string | undefined;
  try {
    const image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const ref = await media.uploadImage({
      buffer: image,
      mimetype: "image/png",
      size: image.length,
    } as Express.Multer.File);
    mediaId = ref.id;
    const input = draft();
    input.topics[0].questions = [
      {
        type: "geo",
        value: 100,
        promptText: "Где Самара?",
        answerText: "",
        choices: [],
        correctChoiceIndex: null,
        geoTarget: { lat: 53.1959, lng: 50.1002 },
      },
      {
        type: "geo",
        value: 150,
        promptText: "",
        answerText: "",
        choices: [],
        correctChoiceIndex: null,
        geoMapMode: "image",
        geoMapMedia: ref,
        imageTarget: { x: 0.25, y: 0.7 },
      },
      {
        type: "image-point",
        value: 200,
        promptText: "Найди точку",
        questionMedia: ref,
        answerText: "",
        choices: [],
        correctChoiceIndex: null,
        imageTarget: { x: 0.4, y: 0.6 },
        imageTolerancePercent: 6,
      },
      {
        type: "comparison",
        value: 300,
        promptText: "Что дороже?",
        answerText: "",
        choices: [],
        correctChoiceIndex: null,
        comparisonUnit: "₽",
        comparisonOptions: [
          { id: randomUUID(), label: "Первый", amount: 500, media: ref },
          { id: randomUUID(), label: "Второй", amount: 1200 },
        ],
      },
    ];
    assert.deepEqual(await validate(plainToInstance(PackDto, input)), []);
    const saved = await packs.create(input);
    packId = saved.id;
    const reloaded = await repository.find(saved.id);
    assert.deepEqual(reloaded?.topics[0].questions[0].geoTarget, { lat: 53.1959, lng: 50.1002 });
    assert.equal(reloaded?.topics[0].questions[0].geoToleranceKm, undefined);
    assert.equal(reloaded?.topics[0].questions[1].geoMapMedia?.id, ref.id);
    assert.deepEqual(reloaded?.topics[0].questions[1].imageTarget, { x: 0.25, y: 0.7 });
    assert.equal(reloaded?.topics[0].questions[1].imageTolerancePercent, undefined);
    assert.equal(reloaded?.topics[0].questions[2].imageTolerancePercent, 6);
    assert.equal(reloaded?.topics[0].questions[3].comparisonOptions?.[0].media?.id, ref.id);
    const invalid = structuredClone(input);
    invalid.topics[0].questions[3].comparisonOptions![1].amount = 500;
    await assert.rejects(() => packs.create(invalid), /Самый большой вариант/);
    invalid.topics[0].questions[3].comparisonOptions![1].amount = 1200;
    invalid.topics[0].questions[2].imageTarget = undefined;
    await assert.rejects(() => packs.create(invalid), /правильную точку/);
    invalid.topics[0].questions[2].imageTarget = { x: 0.4, y: 0.6 };
    invalid.topics[0].questions[1].promptText = "Где место?";
    invalid.topics[0].questions[1].geoMapMedia = undefined;
    await assert.rejects(() => packs.create(invalid), /Загрузи изображение карты/);
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    if (mediaId) await prisma.mediaAsset.deleteMany({ where: { id: mediaId } });
    await prisma.$disconnect();
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("image upload enforces the configured limit and creates WebP", async () => {
  const previous = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "qwiza-media-test-"));
  process.chdir(directory);
  const { prisma, media, packs } = await testServices();
  let packId: string | undefined;
  let mediaId: string | undefined;
  try {
    const input = await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    const file = {
      buffer: input,
      mimetype: "image/png",
      size: input.length,
    } as Express.Multer.File;
    const ref = await media.uploadImage(file);
    mediaId = ref.id;
    assert.equal(ref.kind, "image");
    const output = await readFile(join(directory, ".local-data", "media", `${ref.id}.webp`));
    assert.equal((await sharp(output).metadata()).format, "webp");
    const mediaOnly = draft();
    mediaOnly.topics[0].questions = [
      {
        type: "text",
        value: 100,
        promptText: "",
        questionMedia: ref,
        answerText: "красный",
        answerMedia: ref,
        choices: [],
        correctChoiceIndex: null,
      },
      {
        type: "matching",
        value: 200,
        promptText: "Соотнеси пары",
        answerText: "",
        choices: [],
        correctChoiceIndex: null,
        matchingPairs: [
          { element: "Красный", fact: "Первый цвет", media: ref },
          { element: "Синий", fact: "Второй цвет" },
        ],
      },
    ];
    const saved = await packs.create(mediaOnly);
    packId = saved.id;
    assert.equal((await packs.get(saved.id)).topics[0].questions[0].questionMedia?.id, ref.id);
    assert.equal(
      (await packs.get(saved.id)).topics[0].questions[1].matchingPairs?.[0].media?.id,
      ref.id,
    );
    await assert.rejects(
      () => media.uploadImage({ ...file, size: 3 * 1024 * 1024 + 1 }),
      /Превышен размер/,
    );
    await assert.rejects(
      () => media.uploadImage({ ...file, mimetype: "image/svg+xml" }),
      /Неподдерживаемый формат/,
    );
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    if (mediaId) await prisma.mediaAsset.deleteMany({ where: { id: mediaId } });
    await prisma.$disconnect();
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("video upload re-encodes to MP4 and enforces its own limit", async () => {
  assert.ok(ffmpegPath);
  const previous = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "qwiza-video-test-"));
  process.chdir(directory);
  const { prisma, media, packs, repository } = await testServices();
  let mediaId: string | undefined;
  let packId: string | undefined;
  try {
    const inputPath = join(directory, "input.mp4");
    await runFile(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x64:d=3",
        "-c:v",
        "libx264",
        "-y",
        inputPath,
      ],
      { timeout: 30000 },
    );
    const input = await readFile(inputPath);
    const file = {
      buffer: input,
      mimetype: "video/mp4",
      size: input.length,
    } as Express.Multer.File;
    const ref = await media.uploadVideo(file);
    mediaId = ref.id;
    const output = await readFile(join(directory, ".local-data", "media", `${ref.id}.mp4`));
    assert.equal(ref.kind, "video");
    assert.ok((ref.durationSeconds ?? 0) >= 2.9);
    assert.equal(output.toString("ascii", 4, 8), "ftyp");
    const inputPack = draft();
    inputPack.topics[0].questions[0] = {
      ...inputPack.topics[0].questions[0],
      type: "video-prediction",
      questionMedia: ref,
      videoStopSeconds: 1,
      answerText: "Упал",
      choices: [],
      correctChoiceIndex: null,
    };
    const saved = await packs.create(inputPack);
    packId = saved.id;
    assert.equal((await repository.find(saved.id))?.topics[0].questions[0].videoStopSeconds, 1);
    await assert.rejects(
      () =>
        packs.update(saved.id, {
          ...inputPack,
          topics: [
            {
              ...inputPack.topics[0],
              questions: [{ ...inputPack.topics[0].questions[0], answerMedia: ref }],
            },
          ],
        }),
      /только одно видео/,
    );
    await assert.rejects(
      () =>
        packs.update(saved.id, {
          ...inputPack,
          topics: [
            {
              ...inputPack.topics[0],
              questions: [{ ...inputPack.topics[0].questions[0], videoStopSeconds: 3 }],
            },
          ],
        }),
      /остановк|длительность/,
    );
    await assert.rejects(
      () => media.uploadVideo({ ...file, size: 20 * 1024 * 1024 + 1 }),
      /Превышен размер/,
    );
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    if (mediaId) await prisma.mediaAsset.deleteMany({ where: { id: mediaId } });
    await prisma.$disconnect();
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("an audio clip is trimmed on the server and its duration survives pack storage", async () => {
  assert.ok(ffmpegPath);
  const previous = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "qwiza-audio-test-"));
  process.chdir(directory);
  const { prisma, media, packs, repository } = await testServices();
  let mediaId: string | undefined;
  let packId: string | undefined;
  try {
    const inputPath = join(directory, "song.wav");
    await runFile(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=5",
        "-c:a",
        "pcm_s16le",
        "-y",
        inputPath,
      ],
      { timeout: 30000 },
    );
    const input = await readFile(inputPath);
    const file = {
      buffer: input,
      mimetype: "audio/wav",
      size: input.length,
    } as Express.Multer.File;
    const ref = await media.uploadAudio(file, 1, 3.5);
    mediaId = ref.id;
    assert.equal(ref.kind, "audio");
    assert.ok((ref.durationSeconds ?? 0) >= 2.4 && (ref.durationSeconds ?? 0) < 2.7);
    const encoded = await readFile(join(directory, ".local-data", "media", `${ref.id}.mp3`));
    assert.ok(encoded.length > 1000);
    const partial = await media.get("audio", ref.id, "bytes=10-19");
    assert.equal(partial.status, 206);
    assert.equal(partial.headers["Content-Range"], `bytes 10-19/${encoded.length}`);
    assert.equal(partial.headers["Content-Length"], "10");
    const chunks: Buffer[] = [];
    for await (const chunk of partial.file.getStream()) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), encoded.subarray(10, 20));
    await assert.rejects(() => media.get("audio", ref.id, "bytes=999999-"), /диапазон/);
    const inputPack = draft();
    inputPack.topics[0].questions[0].questionMedia = { ...ref, durationSeconds: 30 };
    const saved = await packs.create(inputPack);
    packId = saved.id;
    assert.equal(saved.topics[0].questions[0].questionMedia?.durationSeconds, ref.durationSeconds);
    assert.equal(
      (await repository.find(saved.id))?.topics[0].questions[0].questionMedia?.durationSeconds,
      ref.durationSeconds,
    );
    await assert.rejects(() => media.uploadAudio(file, 4, 7), /выходит за длительность/);
    await assert.rejects(() => media.uploadAudio(file, 1, 1.5), /от 2 до 30 секунд/);
  } finally {
    if (packId) await prisma.pack.deleteMany({ where: { id: packId } });
    if (mediaId) await prisma.mediaAsset.deleteMany({ where: { id: mediaId } });
    await prisma.$disconnect();
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
