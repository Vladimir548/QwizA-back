import { applyRoomDuel } from "./room-duels";
import { captureRoomStatistics, isRoomComplete, roomResultSummary } from "./room-statistics";
import { createQuizStatistics, defaultVictoryRules, isVictoryRules } from "@qwiza/minigames";
import { eligibleHostBuzzPlayers, pauseHostBuzzer, resumeHostBuzzer } from "./host-buzzer";
import { duelTransfers } from "@qwiza/minigames";
import { rewardCorrectAnswer } from "./bonus-rewards";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PacksRepository } from "../workshop/packs.repository";
import type { WorkshopPack, WorkshopQuestion } from "../workshop/workshop.model";
import { starterPack } from "./starter-pack";
import type {
  PrivateRoomState,
  RoomCommandAck,
  RoomCommandInput,
  RoomPack,
  RoomQuestion,
  RoomResponse,
} from "./rooms.types";
import type { CreateRoomDto, JoinRoomDto } from "./rooms.dto";
import { matchesTextAnswer, normalizeAnswer } from "./text-answer";
import { skipRoomTopic } from "./topic-skipping";
import { awardTopicPrizes, castTopicMinigameVote } from "@qwiza/minigames";
import { openTopicMinigameVote } from "./topic-minigame-vote";
import { TopicMinigamesService } from "./topic-minigames.service";

import { hidesFinalScores, emptyQuizPlayerStats } from "@qwiza/minigames";
import { openRoomFinal, progressRoomFinal, roomFinalView } from "./room-final";

type RoomRecord = Prisma.GameRoomGetPayload<{ include: { participants: true } }>;
type Tx = Prisma.TransactionClient;
const ARBITRATION_MS = 120;
const RESULT_MS = 5000;
const PICKER_ROULETTE_MS = 4500;

export function questionReadingDurationMs(question: RoomQuestion): number {
  if (question.questionMedia?.kind === "audio")
    return Math.ceil((question.questionMedia.durationSeconds ?? 0) * 1000) + 2000;
  if (question.type === "video-prediction")
    return Math.ceil((question.videoStopSeconds ?? 0) * 1000) + 1500;
  return question.prompt.trim() ? Math.max(3000, Math.min(12000, question.prompt.length * 45)) : 0;
}

export function voteToSkipAudio(
  state: PrivateRoomState,
  playerIds: string[],
  participantId: string,
  now: number,
  answerTimeSeconds: number,
): boolean {
  state.audioSkippedPlayers ??= [];
  if (!state.audioSkippedPlayers.includes(participantId))
    state.audioSkippedPlayers.push(participantId);
  if (!playerIds.every((id) => state.audioSkippedPlayers!.includes(id))) return false;
  state.readingEndsAt = now;
  state.buzzOpensAt = now;
  state.deadlineAt = now + answerTimeSeconds * 1000;
  return true;
}

type PickerPlayer = { id: string; role: string; teamId: string | null; seatNumber: number | null };

export function seatedPlayers<T extends PickerPlayer>(participants: T[]): T[] {
  return participants
    .filter((person) => person.role === "player")
    .sort(
      (a, b) =>
        (a.teamId ?? "").localeCompare(b.teamId ?? "") ||
        (a.seatNumber ?? 0) - (b.seatNumber ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

export function teamScoreAdjustment<T extends PickerPlayer & { score: number }>(
  participants: T[],
  teamId: string,
  desiredScore: number,
): { participantId: string; score: number } | null {
  const teammates = seatedPlayers(participants).filter((person) => person.teamId === teamId);
  if (!teammates.length) return null;
  const currentScore = teammates.reduce((sum, person) => sum + person.score, 0);
  return {
    participantId: teammates[0].id,
    score: teammates[0].score + desiredScore - currentScore,
  };
}

export function openingPickerCandidates<T extends PickerPlayer>(
  participants: T[],
  gameMode: string,
): T[] {
  const players = seatedPlayers(participants);
  if (gameMode !== "team") return players;
  const seenTeams = new Set<string>();
  return players.filter((player) => {
    if (!player.teamId || seenTeams.has(player.teamId)) return false;
    seenTeams.add(player.teamId);
    return true;
  });
}

export function nextQuestionPicker(
  participants: PickerPlayer[],
  currentPickerId: string | undefined,
  responses: RoomResponse[],
  buzzWinnerId?: string,
): string | undefined {
  const players = seatedPlayers(participants);
  if (!players.length) return undefined;
  const correct = responses.find((response) => response.correct);
  if (correct) return correct.participantId;
  const lastResponderId = responses.at(-1)?.participantId ?? buzzWinnerId ?? currentPickerId;
  const index = players.findIndex((person) => person.id === lastResponderId);
  return players[(index + 1) % players.length].id;
}

export function buildRoomPresentation(pack: RoomPack, startedAt: number) {
  const count = Math.max(
    1,
    pack.rounds?.length ?? 1,
    ...pack.topics.map((topic) => (topic.roundIndex ?? 0) + 1),
  );
  // Reserve the same brand introduction interval as the local game client.
  let cursor = startedAt + 2400;
  return Array.from({ length: count }, (_, index) => {
    const topics = pack.topics
      .filter((topic) => !topic.isFinal && (topic.roundIndex ?? 0) === index)
      .map(({ id, title }) => ({ id, title }));
    const round = {
      index,
      title: pack.rounds?.[index] || `Раунд ${index + 1}`,
      topics,
      startsAt: cursor,
      endsAt: cursor + 900 + topics.length * 520 + 1500,
    };
    cursor = round.endsAt;
    return round;
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseState(room: RoomRecord): PrivateRoomState {
  return structuredClone(room.state) as unknown as PrivateRoomState;
}

function hostIsEnabled(room: RoomRecord) {
  return parseState(room).hostEnabled ?? room.participants.some((person) => person.role === "host");
}

export function chooseTeamSeat(
  room: Pick<RoomRecord, "gameMode" | "teamCount" | "maxPlayers">,
  players: { teamId: string | null }[],
  teamNumber?: number,
): { teamId: string | null; error?: string } {
  if (room.gameMode !== "team") return { teamId: null };
  if (
    teamNumber !== undefined &&
    (!Number.isSafeInteger(teamNumber) || teamNumber < 1 || teamNumber > room.teamCount)
  )
    return { teamId: null, error: "Выбери существующую команду" };
  const capacity = room.maxPlayers / room.teamCount;
  const teams = Array.from({ length: room.teamCount }, (_, index) => ({
    number: index + 1,
    count: players.filter((player) => player.teamId === `team-${index + 1}`).length,
  }));
  const selected =
    teamNumber === undefined
      ? teams
          .filter((team) => team.count < capacity)
          .sort((a, b) => a.count - b.count || a.number - b.number)[0]
      : teams[teamNumber - 1];
  if (!selected || selected.count >= capacity)
    return { teamId: null, error: "В этой команде нет свободных мест" };
  return { teamId: `team-${selected.number}` };
}

export function chooseSeatNumber(
  players: { teamId: string | null; seatNumber: number | null }[],
  teamId: string | null,
  capacity: number,
  requested?: number,
): { seatNumber?: number; error?: string } {
  if (
    requested !== undefined &&
    (!Number.isSafeInteger(requested) || requested < 1 || requested > capacity)
  )
    return { error: "Выбери существующее место" };
  const occupied = new Set(
    players.filter((player) => player.teamId === teamId).map((player) => player.seatNumber),
  );
  const seatNumber =
    requested ??
    Array.from({ length: capacity }, (_, index) => index + 1).find(
      (number) => !occupied.has(number),
    );
  if (!seatNumber || occupied.has(seatNumber)) return { error: "Это место уже занято" };
  return { seatNumber };
}

function parsePack(room: RoomRecord): RoomPack {
  return room.pack as unknown as RoomPack;
}

function findQuestion(pack: RoomPack, id: string): RoomQuestion | undefined {
  return pack.topics.flatMap((topic) => topic.questions).find((question) => question.id === id);
}

export function activeRound(pack: RoomPack, state: PrivateRoomState) {
  if (state.topicEvent) return state.topicEvent.roundIndex;
  const currentTopic = pack.topics.find((topic) =>
    topic.questions.some((question) => question.id === state.currentQuestionId),
  );
  if (currentTopic) return currentTopic.roundIndex ?? 0;
  const rounds = Math.max(
    pack.rounds?.length ?? 1,
    ...pack.topics.map((topic) => (topic.roundIndex ?? 0) + 1),
  );
  for (let index = 0; index < rounds; index++) {
    if (
      pack.topics.some(
        (topic) =>
          !topic.isFinal &&
          (topic.roundIndex ?? 0) === index &&
          topic.questions.some((question) => !state.played.includes(question.id)),
      )
    )
      return index;
  }
  return rounds - 1;
}

export function roundMedia(pack: RoomPack, roundIndex: number) {
  type Asset = NonNullable<RoomQuestion["questionMedia"]>;
  const assets = new Map<string, Asset>();
  for (const topic of pack.topics) {
    if (topic.isFinal || (topic.roundIndex ?? 0) !== roundIndex) continue;
    for (const question of topic.questions) {
      const refs = [
        question.questionMedia,
        question.answerMedia,
        question.geoMapMedia,
        question.differenceMedia,
        ...(question.comparisonOptions?.map((option) => option.media) ?? []),
        ...(question.matchingPairs?.map((pair) => pair.media) ?? []),
      ];
      for (const ref of refs) if (ref) assets.set(`${ref.kind}:${ref.id}`, ref);
    }
  }
  return [...assets.values()];
}

function completeRoundLoading(state: PrivateRoomState, pack: RoomPack, now: number) {
  if (state.loadingAfter === "presentation") {
    const presentation = buildRoomPresentation(pack, now);
    state.phase = "presentation";
    state.presentationStartedAt = now;
    state.deadlineAt = presentation.at(-1)!.endsAt;
    state.pickerRouletteStartedAt = state.deadlineAt;
    state.pickerRouletteEndsAt = state.deadlineAt + PICKER_ROULETTE_MS;
  } else {
    state.phase = "board";
  }
  state.loadingRoundIndex = undefined;
  state.loadingStartedAt = undefined;
  state.loadingAfter = undefined;
  state.loadingProgress = undefined;
}

function beginRoundLoading(
  state: PrivateRoomState,
  pack: RoomPack,
  roundIndex: number,
  after: "presentation" | "board",
  now: number,
) {
  state.phase = "loading";
  state.loadingRoundIndex = roundIndex;
  state.loadingStartedAt = now;
  state.loadingAfter = after;
  state.loadingProgress = {};
  state.deadlineAt = undefined;
  if (!roundMedia(pack, roundIndex).length) completeRoundLoading(state, pack, now);
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const lat = (b.lat - a.lat) * rad;
  const lng = (b.lng - a.lng) * rad;
  const hav =
    Math.sin(lat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(hav)));
}

export function isCorrectAnswer(question: RoomQuestion, answer: RoomResponse["answer"]): boolean {
  if (question.type === "matching")
    return (
      Array.isArray(answer) &&
      answer.length === question.matchingPairs?.length &&
      answer.every(
        (factIndex, elementIndex) =>
          typeof factIndex === "number" &&
          Number.isInteger(factIndex) &&
          question.matchingFacts?.[factIndex] === question.matchingPairs?.[elementIndex].fact,
      )
    );
  if (question.type === "numeric-closest")
    return (
      typeof answer === "number" && Number.isFinite(answer) && answer === question.numericTarget
    );
  if (question.type === "puzzle") {
    const count = (question.puzzleGridSize ?? 0) ** 2;
    return (
      Array.isArray(answer) &&
      answer.length === count &&
      answer.every((value, index) => value === index)
    );
  }
  if (question.type === "spot-difference") {
    const targets = question.differenceTargets ?? [];
    if (
      !Array.isArray(answer) ||
      answer.length !== targets.length ||
      !targets.length ||
      !answer.every(
        (point) =>
          typeof point === "object" &&
          point !== null &&
          "x" in point &&
          "y" in point &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y),
      )
    )
      return false;
    const points = answer as { x: number; y: number }[];
    const tolerance = (question.differenceTolerancePercent ?? 5) / 100;
    const match = (targetIndex: number, used: Set<number>): boolean => {
      if (targetIndex === targets.length) return true;
      return points.some((point, index) => {
        if (
          used.has(index) ||
          Math.hypot(point.x - targets[targetIndex].x, point.y - targets[targetIndex].y) > tolerance
        )
          return false;
        used.add(index);
        const found = match(targetIndex + 1, used);
        used.delete(index);
        return found;
      });
    };
    return match(0, new Set());
  }
  if (question.type === "geo" && question.geoMapMode === "image") {
    return (
      typeof answer === "object" &&
      answer !== null &&
      "x" in answer &&
      Number.isFinite(answer.x) &&
      Number.isFinite(answer.y) &&
      !!question.imageTarget &&
      Math.hypot(answer.x - question.imageTarget.x, answer.y - question.imageTarget.y) * 100 <= 3
    );
  }
  if (question.type === "geo") {
    return (
      typeof answer === "object" &&
      answer !== null &&
      "lat" in answer &&
      Number.isFinite(answer.lat) &&
      Number.isFinite(answer.lng) &&
      !!question.geoTarget &&
      distanceKm(answer, question.geoTarget) <= 10
    );
  }
  if (question.type === "image-point") {
    return (
      typeof answer === "object" &&
      answer !== null &&
      "x" in answer &&
      Number.isFinite(answer.x) &&
      Number.isFinite(answer.y) &&
      !!question.imageTarget &&
      Math.hypot(answer.x - question.imageTarget.x, answer.y - question.imageTarget.y) * 100 <=
        (question.imageTolerancePercent ?? 5)
    );
  }
  if (question.type === "comparison") {
    const top = question.comparisonOptions?.reduce(
      (best, option) => (!best || option.amount > best.amount ? option : best),
      undefined as NonNullable<RoomQuestion["comparisonOptions"]>[number] | undefined,
    );
    return typeof answer === "string" && top?.id === answer;
  }
  const text = typeof answer === "number" ? question.options[answer] : answer;
  if (typeof text !== "string") return false;
  if (
    typeof answer === "string" &&
    (question.type === "text" ||
      (question.type === "video-prediction" && question.options.length === 0))
  )
    return matchesTextAnswer(text, question.answer, question.acceptedAnswers);
  return [question.answer, ...question.acceptedAnswers].some(
    (accepted) => normalizeAnswer(accepted) === normalizeAnswer(text),
  );
}

export function closestWinners(responses: RoomResponse[], target: number): string[] {
  const guesses = responses.filter(
    (response) => typeof response.answer === "number" && Number.isFinite(response.answer),
  );
  if (!guesses.length) return [];
  const distance = Math.min(
    ...guesses.map((response) => Math.abs((response.answer as number) - target)),
  );
  return guesses
    .filter((response) => Math.abs((response.answer as number) - target) === distance)
    .map((response) => response.participantId);
}

export function hostJudgedDelta(
  question: RoomQuestion,
  correct: boolean,
  multiplier: 0.5 | 1 | 2,
  active?: { double?: boolean; shield?: boolean },
) {
  const price = question.value * (question.type === "risk" ? 2 : 1);
  return correct
    ? Math.round(price * multiplier * (active?.double ? 2 : 1))
    : active?.shield
      ? 0
      : -price;
}

export function getOrCreateHostResponse(
  state: PrivateRoomState,
  participantId: string,
  spokenAnswer = "",
) {
  const submitted = state.responses.find((item) => item.participantId === participantId);
  if (submitted) return submitted;
  const verbal: RoomResponse = {
    participantId,
    answer: spokenAnswer,
    correct: false,
    scoreDelta: 0,
    verbal: true,
  };
  state.responses.push(verbal);
  return verbal;
}

export function chooseBuzzWinner(candidates: PrivateRoomState["buzzCandidates"], seed: string) {
  return [...candidates].sort((a, b) =>
    createHash("sha256")
      .update(`${seed}:${a.participantId}`)
      .digest("hex")
      .localeCompare(createHash("sha256").update(`${seed}:${b.participantId}`).digest("hex")),
  )[0]?.participantId;
}

function workshopQuestion(question: WorkshopQuestion): RoomQuestion {
  const matchingFacts = question.matchingPairs?.map((pair) => pair.fact);
  if (matchingFacts && matchingFacts.length > 1) {
    for (let index = matchingFacts.length - 1; index > 0; index--) {
      const swap = randomInt(index + 1);
      [matchingFacts[index], matchingFacts[swap]] = [matchingFacts[swap], matchingFacts[index]];
    }
    if (matchingFacts.every((fact, index) => fact === question.matchingPairs?.[index].fact))
      matchingFacts.push(matchingFacts.shift()!);
  }
  const comparisonWinner = question.comparisonOptions?.reduce(
    (best, option) => (!best || option.amount > best.amount ? option : best),
    undefined as NonNullable<WorkshopQuestion["comparisonOptions"]>[number] | undefined,
  );
  return {
    id: question.id,
    type: question.type,
    answerMode: question.answerMode,
    answerTimeSeconds: question.answerTimeSeconds,
    value: question.value,
    prompt: question.promptText,
    options: question.choices,
    answer:
      question.type === "choice" ||
      (question.type === "video-prediction" && question.correctChoiceIndex != null)
        ? (question.choices[question.correctChoiceIndex ?? -1] ?? question.answerText)
        : question.type === "comparison"
          ? (comparisonWinner?.label ?? question.answerText)
          : question.type === "numeric-closest"
            ? `${question.numericTarget}${question.numericUnit ? ` ${question.numericUnit}` : ""}`
            : question.type === "puzzle"
              ? "Изображение собрано"
              : question.type === "spot-difference"
                ? "Все отличия найдены"
                : question.type === "matching"
                  ? "Все пары сопоставлены"
                  : question.answerText,
    acceptedAnswers: question.acceptedAnswers,
    questionMedia: question.questionMedia,
    answerMedia: question.answerMedia,
    geoMapMode: question.geoMapMode,
    geoMapMedia: question.geoMapMedia,
    geoTarget: question.geoTarget,
    geoToleranceKm: question.geoToleranceKm,
    imageTarget: question.imageTarget,
    imageTolerancePercent: question.imageTolerancePercent,
    comparisonOptions: question.comparisonOptions?.map(({ id, label, amount, media }) => ({
      id,
      label,
      amount,
      media,
    })),
    comparisonUnit: question.comparisonUnit,
    numericTarget: question.numericTarget,
    numericUnit: question.numericUnit,
    puzzleGridSize: question.puzzleGridSize,
    differenceMedia: question.differenceMedia,
    differenceTargets: question.differenceTargets,
    differenceTolerancePercent: question.differenceTolerancePercent,
    matchingPairs: question.matchingPairs,
    matchingFacts,
    videoStopSeconds: question.videoStopSeconds,
  };
}

function workshopPack(pack: WorkshopPack): RoomPack {
  return {
    id: pack.id,
    title: pack.title,
    description: pack.description,
    rounds: pack.rounds,
    topics: pack.topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      roundIndex: topic.roundIndex,
      isFinal: topic.isFinal,
      ordered: topic.ordered,
      direction: topic.direction,
      questions: topic.questions.map(workshopQuestion),
    })),
  };
}

@Injectable()
export class RoomsService implements OnModuleInit {
  private readonly logger = new Logger(RoomsService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly connections = new Map<string, Set<string>>();
  private listeners = new Set<(roomId: string) => void>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly packs: PacksRepository,
    @Optional() private readonly topicGames?: TopicMinigamesService,
  ) {}

  async onModuleInit() {
    const rooms = await this.prisma.gameRoom.findMany({
      where: { deadlineAt: { not: null } },
      select: { id: true, deadlineAt: true },
    });
    for (const room of rooms) this.schedule(room.id, room.deadlineAt?.getTime());
  }

  subscribe(listener: (roomId: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(roomId: string) {
    for (const listener of this.listeners) listener(roomId);
  }

  setConnected(participantId: string, socketId: string, connected: boolean, roomId: string) {
    const sockets = this.connections.get(participantId) ?? new Set<string>();
    if (connected) sockets.add(socketId);
    else sockets.delete(socketId);
    if (sockets.size) this.connections.set(participantId, sockets);
    else this.connections.delete(participantId);
    this.notify(roomId);
  }

  async resolveCode(code: string) {
    const room =
      /^[a-f0-9]{8}$/i.test(code) &&
      (await this.prisma.gameRoom.findUnique({
        where: { code: code.toUpperCase() },
        select: { id: true },
      }));
    if (!room) throw new NotFoundException("Комната с таким кодом не найдена.");
    return room;
  }

  private code() {
    return randomBytes(4).toString("hex").toUpperCase();
  }

  async create(input: CreateRoomDto) {
    const teamCount = input.gameMode === "team" ? (input.teamCount ?? 2) : 1;
    if (input.gameMode === "solo" && (input.maxPlayers > 6 || input.teamCount !== undefined))
      throw new BadRequestException("В режиме каждый за себя от двух до шести игроков");
    if (
      input.gameMode === "team" &&
      (!Number.isInteger(teamCount) ||
        teamCount < 2 ||
        teamCount > 4 ||
        input.maxPlayers % teamCount !== 0 ||
        input.maxPlayers / teamCount < 2 ||
        input.maxPlayers / teamCount > 3)
    )
      throw new BadRequestException("В каждой команде должно быть от двух до трёх игроков");
    if (!input.name.trim() || !input.displayName.trim())
      throw new BadRequestException("Укажи название комнаты и имя игрока");
    const requestedPack = input.packId ? await this.packs.find(input.packId) : undefined;
    if (input.packId && !requestedPack) throw new NotFoundException("Пак не найден");
    const pack = requestedPack ? workshopPack(requestedPack) : starterPack;
    if (
      pack.topics.some(
        (t) =>
          t.isFinal &&
          (t.questions.length !== 1 || !["text", "choice"].includes(t.questions[0].type)),
      )
    )
      throw new BadRequestException("Заполни финальные вопросы перед началом игры");
    if (!pack.topics.some((topic) => !topic.isFinal && topic.questions.length))
      throw new BadRequestException("В паке нет вопросов");
    const roomId = randomUUID();
    const participantId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const hostEnabled = input.hostEnabled ?? input.requestedRole === "host";
    const state: PrivateRoomState = {
      victory: input.victory ?? defaultVictoryRules(),
      statistics: createQuizStatistics(),
      phase: "lobby",
      hostEnabled,
      hostRebuzzEnabled: hostEnabled && (input.hostRebuzzEnabled ?? true),
      played: [],
      buzzCandidates: [],
      responses: [],
      powersEnabled: input.powersEnabled ?? false,
      topicMinigamesEnabled: input.topicMinigamesEnabled ?? true,
      powersByPlayer: {},
      correctAnswers: {},
    };
    const room = await this.prisma.gameRoom.create({
      data: {
        id: roomId,
        code: this.code(),
        name: input.name.trim(),
        packId: requestedPack?.id,
        gameMode: input.gameMode,
        teamCount,
        maxPlayers: input.maxPlayers,
        creatorId: participantId,
        state: state as unknown as Prisma.InputJsonValue,
        pack: pack as unknown as Prisma.InputJsonValue,
        participants: {
          create: {
            id: participantId,
            tokenHash: hashToken(token),
            name: input.displayName.trim(),
            role: state.hostEnabled && input.requestedRole === "host" ? "host" : "player",
            teamId:
              input.gameMode === "team" && !(state.hostEnabled && input.requestedRole === "host")
                ? "team-1"
                : null,
            seatNumber: state.hostEnabled && input.requestedRole === "host" ? null : 1,
          },
        },
      },
      include: { participants: true },
    });
    return { roomId, participantId, token, snapshot: this.toSnapshot(room) };
  }

  async join(roomId: string, input: JoinRoomDto) {
    if (!input.displayName.trim()) throw new BadRequestException("Укажи имя игрока");
    const participantId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const room = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, roomId);
      const current = await tx.gameRoom.findUnique({
        where: { id: roomId },
        include: { participants: true },
      });
      if (!current) throw new NotFoundException("Комната не найдена");
      const players = current.participants.filter((participant) => participant.role === "player");
      const role =
        input.requestedRole === "host" &&
        hostIsEnabled(current) &&
        !current.participants.some((p) => p.role === "host")
          ? "host"
          : "player";
      if (role === "player" && players.length >= current.maxPlayers)
        throw new ConflictException("За столом нет свободных мест");
      if (parseState(current).phase !== "lobby")
        throw new ConflictException("Игра уже началась; вернись со своим прежним ключом участника");
      const placement =
        role === "player" ? chooseTeamSeat(current, players, input.teamNumber) : { teamId: null };
      if (placement.error) throw new ConflictException(placement.error);
      const seat =
        role === "player"
          ? chooseSeatNumber(
              players,
              placement.teamId,
              current.gameMode === "team"
                ? current.maxPlayers / current.teamCount
                : current.maxPlayers,
            )
          : { seatNumber: undefined };
      if (seat.error) throw new ConflictException(seat.error);
      await tx.gameParticipant.create({
        data: {
          id: participantId,
          roomId,
          tokenHash: hashToken(token),
          name: input.displayName.trim(),
          role,
          teamId: placement.teamId,
          seatNumber: seat.seatNumber,
        },
      });
      return tx.gameRoom.update({
        where: { id: roomId },
        data: { revision: { increment: 1 } },
        include: { participants: true },
      });
    });
    this.notify(roomId);
    return { roomId, participantId, token, snapshot: this.toSnapshot(room) };
  }

  async authenticate(roomId: string, token?: string) {
    if (!token || token.length > 200) throw new UnauthorizedException("Нужен ключ участника");
    const participant = await this.prisma.gameParticipant.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!participant || participant.roomId !== roomId)
      throw new UnauthorizedException("Неверный ключ участника");
    return participant;
  }

  async snapshot(roomId: string, token?: string) {
    await this.authenticate(roomId, token);
    await this.advance(roomId);
    return this.publicSnapshot(roomId);
  }

  async topicMinigame(roomId: string, token?: string) {
    const participant = await this.authenticate(roomId, token);
    await this.advance(roomId);
    const room = await this.prisma.gameRoom.findUniqueOrThrow({
      where: { id: roomId },
      include: { participants: true },
    });
    const state = parseState(room);
    if (!state.topicEvent?.selected || state.phase !== "minigame" || !this.topicGames)
      throw new BadRequestException("Сейчас нет активной мини-игры");
    const view = this.topicGames.view(roomId, state.topicEvent, room.participants, participant.id);
    return { session: view.session, snapshot: view.snapshot };
  }

  async duelMinigame(roomId: string, token?: string) {
    const participant = await this.authenticate(roomId, token);
    await this.advance(roomId);
    const room = await this.prisma.gameRoom.findUniqueOrThrow({
      where: { id: roomId },
      include: { participants: true },
    });
    const state = parseState(room);
    if (state.phase !== "duel" || !state.duel || !this.topicGames)
      throw new BadRequestException("Сейчас нет активной дуэли");
    const view = this.topicGames.duelView(roomId, state.duel, room.participants, participant.id);
    return { session: view.session, snapshot: view.snapshot };
  }

  async hostAnswer(roomId: string, token?: string) {
    const participant = await this.authenticate(roomId, token);
    if (participant.role !== "host") throw new ForbiddenException("Ответ доступен только ведущему");
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room) throw new NotFoundException("Комната не найдена");
    const state = parseState(room);
    const question = state.currentQuestionId
      ? findQuestion(parsePack(room), state.currentQuestionId)
      : undefined;
    return {
      questionId: question?.id ?? null,
      answer:
        question?.type === "matching"
          ? (question.matchingPairs?.map((pair) => `${pair.element} — ${pair.fact}`).join(" · ") ??
            null)
          : (question?.answer ?? null),
      acceptedAnswers: question?.acceptedAnswers ?? [],
      responses: state.responses.map(
        ({ participantId, answer, judged, verbal, correct, scoreDelta }) => ({
          participantId,
          answer,
          judged,
          verbal,
          correct,
          scoreDelta,
        }),
      ),
      geoTarget: question?.geoTarget,
      imageTarget: question?.imageTarget,
      differenceTargets: question?.differenceTargets,
    };
  }

  async publicSnapshot(roomId: string) {
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room) throw new NotFoundException("Комната не найдена");
    return this.toSnapshot(room);
  }

  async preview(roomId: string) {
    const room = await this.prisma.gameRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room) throw new NotFoundException("Комната не найдена");
    const state = parseState(room);
    const hostEnabled = hostIsEnabled(room);
    return {
      name: room.name,
      gameMode: room.gameMode,
      teamCount: room.teamCount,
      teamNames: state.teamNames ?? {},
      maxPlayers: room.maxPlayers,
      phase: state.phase,
      playerCount: room.participants.filter((person) => person.role === "player").length,
      teamPlayerCounts: Array.from(
        { length: room.teamCount },
        (_, index) =>
          room.participants.filter(
            (person) => person.role === "player" && person.teamId === `team-${index + 1}`,
          ).length,
      ),
      hostEnabled,
      hostAvailable:
        state.phase === "lobby" &&
        hostEnabled &&
        !room.participants.some((person) => person.role === "host"),
    };
  }

  private toSnapshot(room: RoomRecord) {
    const state = parseState(room);
    const pack = parsePack(room);
    const completed = isRoomComplete(pack, state);
    const hideScores = hidesFinalScores(state.final, state.victory);
    const summary = completed
      ? roomResultSummary(room.participants, room.gameMode === "team", room.teamCount, state)
      : undefined;
    if (summary && hideScores)
      summary.standings = summary.standings.map((entry) => ({
        ...entry,
        score: 0,
        stats: emptyQuizPlayerStats(0),
      }));
    const roundIndex = activeRound(pack, state);
    const roundCount = Math.max(
      pack.rounds?.length ?? 1,
      ...pack.topics.map((topic) => (topic.roundIndex ?? 0) + 1),
    );
    const question = state.currentQuestionId
      ? findQuestion(pack, state.currentQuestionId)
      : undefined;
    return {
      victory: state.victory ?? defaultVictoryRules(),
      statistics: hideScores
        ? undefined
        : {
            byId: state.statistics?.byId ?? {},
            incomplete: state.statistics?.incomplete ?? state.played.length > 0,
          },
      summary,
      id: room.id,
      code: room.code,
      name: room.name,
      creatorParticipantId: room.creatorId,
      revision: room.revision,
      final: roomFinalView(state, pack),
      serverTime: Date.now(),
      phase: state.phase,
      pickerId: state.pickerId,
      pickerRouletteStartedAt: state.pickerRouletteStartedAt,
      pickerRouletteEndsAt: state.pickerRouletteEndsAt,
      gameMode: room.gameMode,
      hostEnabled: hostIsEnabled(room),
      topicSkipVotes: state.topicSkipVotes ?? {},
      topicEvent: state.topicEvent,
      duel: state.duel,
      duelChallenges: state.duelChallenges ?? {},
      teamCount: room.teamCount,
      teamNames: state.teamNames ?? {},
      maxPlayers: room.maxPlayers,
      packTitle: pack.title,
      packDescription: pack.description,
      packTopicCount: pack.topics.length,
      packQuestionCount: pack.topics.reduce((sum, topic) => sum + topic.questions.length, 0),
      roundIndex: state.loadingRoundIndex ?? roundIndex,
      roundCount,
      loadingAssets:
        state.phase === "loading"
          ? roundMedia(pack, state.loadingRoundIndex ?? roundIndex)
          : undefined,
      loadingProgress: state.phase === "loading" ? (state.loadingProgress ?? {}) : undefined,
      loadingStartedAt: state.phase === "loading" ? state.loadingStartedAt : undefined,
      presentationRounds:
        state.phase === "presentation" && state.presentationStartedAt
          ? buildRoomPresentation(pack, state.presentationStartedAt)
          : undefined,
      completed,
      participants: [...room.participants]
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.id.localeCompare(b.id))
        .map((participant) => ({
          id: participant.id,
          name: participant.name,
          role: participant.role,
          teamId: participant.teamId,
          seatNumber: participant.seatNumber,
          score: hideScores ? 0 : participant.score,
          ...(hideScores ? { scoreHidden: true } : {}),
          connected: (this.connections.get(participant.id)?.size ?? 0) > 0,
        })),
      topics: (["lobby", "loading"].includes(state.phase) ? [] : pack.topics)
        .filter((topic) => !topic.isFinal && (topic.roundIndex ?? 0) === roundIndex)
        .map((topic) => ({
          id: topic.id,
          title: topic.title,
          ordered: topic.ordered,
          questions: topic.questions.map((item) => ({
            id: item.id,
            value: item.value,
            played: state.played.includes(item.id),
            blocked: Boolean(
              topic.ordered &&
              item.id !==
                (topic.direction === "reverse"
                  ? topic.questions
                      .filter((candidate) => !state.played.includes(candidate.id))
                      .at(-1)?.id
                  : topic.questions.find((candidate) => !state.played.includes(candidate.id))?.id),
            ),
            answerMode: item.answerMode,
            type: item.type,
          })),
        })),
      currentQuestion: question
        ? {
            id: question.id,
            prompt: question.prompt,
            options:
              question.answerMode === "buzzer" &&
              state.phase === "question" &&
              !state.buzzWinnerId &&
              !state.hostEnabled
                ? []
                : question.options,
            type: question.type,
            answerMode: question.answerMode,
            value: question.value,
            questionMedia: question.questionMedia,
            geoMapMode: question.geoMapMode,
            geoMapMedia: question.geoMapMedia,
            imageTolerancePercent: question.imageTolerancePercent,
            comparisonOptions: question.comparisonOptions?.map(({ id, label, media }) => ({
              id,
              label,
              media,
            })),
            comparisonUnit: question.comparisonUnit,
            numericUnit: question.numericUnit,
            puzzleGridSize: question.puzzleGridSize,
            differenceMedia: question.differenceMedia,
            differenceCount: question.differenceTargets?.length,
            differenceTolerancePercent: question.differenceTolerancePercent,
            matchingElements: question.matchingPairs?.map((pair) => ({
              element: pair.element,
              media: pair.media,
            })),
            matchingFacts: question.matchingFacts,
            videoStopSeconds: question.videoStopSeconds,
            openedAt: state.openedAt,
            audioStartsAt:
              question.questionMedia?.kind === "audio" ? (state.openedAt ?? 0) + 1500 : undefined,
            videoStartsAt:
              question.type === "video-prediction" ? (state.openedAt ?? 0) + 1500 : undefined,
            readingEndsAt: state.readingEndsAt,
            bonusOpensAt: state.bonusOpensAt,
            buzzOpensAt: state.buzzOpensAt,
            deadlineAt: state.deadlineAt,
            buzzRemainingMs: state.buzzRemainingMs,
            answerTimeSeconds: question.answerTimeSeconds,
          }
        : undefined,
      buzzWinnerId: state.buzzWinnerId,
      answeredPlayerIds: state.responses.map((response) => response.participantId),
      reviewResponses:
        state.phase === "review"
          ? state.responses.map(
              ({ participantId, answer, judged, verbal, correct, scoreDelta }) => ({
                participantId,
                answer,
                judged,
                verbal,
                correct: judged ? correct : false,
                scoreDelta: judged ? scoreDelta : 0,
              }),
            )
          : undefined,
      skippedPlayers: state.skippedPlayers ?? [],
      bonusSkippedPlayers: state.bonusSkippedPlayers ?? [],
      audioSkippedPlayers: state.audioSkippedPlayers ?? [],
      powersEnabled: state.powersEnabled ?? false,
      topicMinigamesEnabled: state.topicMinigamesEnabled ?? true,
      hostRebuzzEnabled: hostIsEnabled(room) && state.hostRebuzzEnabled !== false,
      powersByPlayer: state.powersByPlayer ?? {},
      correctAnswers: state.correctAnswers ?? {},
      activePowers: state.activePowers ?? {},
      frozenPlayerId: state.frozenPlayerId,
      result: state.phase === "result" ? state.result : undefined,
    };
  }

  private async lock(tx: Tx, roomId: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "GameRoom" WHERE id = ${roomId}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Комната не найдена");
  }

  private schedule(roomId: string, deadlineAt?: number) {
    const previous = this.timers.get(roomId);
    if (previous) clearTimeout(previous);
    this.timers.delete(roomId);
    if (!deadlineAt) return;
    const timeout = setTimeout(
      () => void this.advance(roomId),
      Math.max(0, deadlineAt - Date.now() + 5),
    );
    timeout.unref?.();
    this.timers.set(roomId, timeout);
  }

  private nextWakeup(state: PrivateRoomState) {
    const times = [state.buzzResolveAt, state.deadlineAt, state.pickerRouletteEndsAt].filter(
      (value): value is number => !!value,
    );
    return times.length ? Math.min(...times) : undefined;
  }

  private async saveState(
    tx: Tx,
    room: RoomRecord,
    state: PrivateRoomState,
    type: string,
    audit?: { candidates: { participantId: string; receivedAt: number }[]; winnerId?: string },
  ) {
    const after = await tx.gameParticipant.findMany({
      where: { roomId: room.id },
      select: { id: true, score: true, role: true, teamId: true },
    });
    openRoomFinal(state, parsePack(room), room.participants, room.gameMode === "team", Date.now());
    captureRoomStatistics(parseState(room), state, room.participants, after, type);
    const revision = room.revision + 1;
    await tx.gameRoom.update({
      where: { id: room.id },
      data: {
        revision,
        state: state as unknown as Prisma.InputJsonValue,
        deadlineAt: this.nextWakeup(state) ? new Date(this.nextWakeup(state)!) : null,
      },
    });
    await tx.gameRoomEvent.create({
      data: {
        id: randomUUID(),
        roomId: room.id,
        revision,
        type,
        payload: { phase: state.phase, ...(audit ?? {}) },
      },
    });
    return revision;
  }

  private async finish(
    tx: Tx,
    state: PrivateRoomState,
    question: RoomQuestion,
    now: number,
    participants: PickerPlayer[],
  ) {
    if (state.responses.some((response) => response.answer !== "" || response.verbal))
      state.answeredQuestions = [...new Set([...(state.answeredQuestions ?? []), question.id])];
    if (
      !state.hostEnabled &&
      question.type === "numeric-closest" &&
      question.numericTarget !== undefined
    ) {
      const winners = new Set(closestWinners(state.responses, question.numericTarget));
      for (const response of state.responses) {
        if (!winners.has(response.participantId)) continue;
        response.correct = true;
        const doubled = state.activePowers?.[response.participantId]?.double;
        response.scoreDelta = question.value * (doubled ? 2 : 1);
        await tx.gameParticipant.update({
          where: { id: response.participantId },
          data: { score: { increment: response.scoreDelta } },
        });
        rewardCorrectAnswer(state, response);
      }
    }
    state.pickerId =
      (state.hostEnabled ? state.lastJudgedCorrectId : undefined) ??
      nextQuestionPicker(participants, state.pickerId, state.responses, state.buzzWinnerId);
    state.phase = "result";
    state.buzzResolveAt = undefined;
    state.buzzCandidates = [];
    state.result = {
      correctAnswer: question.answer,
      responses: [...state.responses],
      geoTarget: question.geoTarget,
      imageTarget: question.imageTarget,
      numericTarget: question.numericTarget,
      differenceTargets: question.differenceTargets,
      matchingPairs: question.matchingPairs,
      comparisonOptions: question.comparisonOptions,
      answerMedia: question.answerMedia,
    };
    state.deadlineAt =
      now +
      (question.type === "video-prediction"
        ? Math.max(
            RESULT_MS,
            ((question.questionMedia?.durationSeconds ?? 0) - (question.videoStopSeconds ?? 0)) *
              1000 +
              2000,
          )
        : RESULT_MS);
  }

  async advance(roomId: string) {
    let changed = false;
    let wakeup: number | undefined;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, roomId);
        const room = await tx.gameRoom.findUniqueOrThrow({
          where: { id: roomId },
          include: { participants: true },
        });
        const state = parseState(room);
        const now = Date.now();
        const pack = parsePack(room);
        if (state.phase === "final" && state.final && state.final.deadlineAt <= now) {
          const changes = progressRoomFinal(state, pack, null, { type: "tick" }, now);
          for (const change of changes)
            await tx.gameParticipant.update({
              where: { id: change.id },
              data: { score: { increment: change.delta } },
            });
          changed = true;
        }
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        let audit:
          | { candidates: { participantId: string; receivedAt: number }[]; winnerId?: string }
          | undefined;
        if (state.phase === "duel" && state.duel && this.topicGames) {
          const view = this.topicGames.duelView(roomId, state.duel, room.participants);
          if (view.snapshot.phase === "complete") {
            for (const [id, delta] of Object.entries(duelTransfers(state.duel, view.winnerId))) {
              await tx.gameParticipant.update({
                where: { id },
                data: { score: { increment: delta } },
              });
            }
            state.duel = { ...state.duel, phase: "result", winnerId: view.winnerId };
            state.phase = "duel-result";
            state.deadlineAt = now + 8000;
          } else state.deadlineAt = now + 1000;
          changed = true;
        }
        if (state.phase === "duel-result" && state.deadlineAt && state.deadlineAt <= now) {
          state.duel = undefined;
          state.phase = "board";
          state.deadlineAt = undefined;
          changed = true;
        }
        if (state.phase === "minigame" && state.topicEvent?.selected && this.topicGames) {
          const view = this.topicGames.view(roomId, state.topicEvent, room.participants);
          if (view.snapshot.phase === "complete") {
            const players = room.participants.filter((person) => person.role === "player");
            const entries = view.points.map((entry) => {
              const player = players.find((person) => person.id === entry.participantId)!;
              return {
                id: room.gameMode === "team" ? player.teamId! : player.id,
                name:
                  room.gameMode === "team"
                    ? (state.teamNames?.[player.teamId!] ??
                      `Команда ${player.teamId!.replace("team-", "")}`)
                    : player.name,
                points: entry.points,
              };
            });
            state.topicEvent.standings = awardTopicPrizes(
              entries,
              state.topicEvent.prize,
              state.topicEvent.selected,
            );
            for (const entry of state.topicEvent.standings) {
              const target =
                room.gameMode === "team"
                  ? players.find((person) => person.teamId === entry.id)!
                  : players.find((person) => person.id === entry.id)!;
              await tx.gameParticipant.update({
                where: { id: target.id },
                data: { score: { increment: entry.prize } },
              });
            }
            state.phase = "minigame-result";
            state.deadlineAt = now + 8000;
          } else state.deadlineAt = now + 1000;
          changed = true;
        }
        if (state.phase === "minigame-result" && state.deadlineAt && state.deadlineAt <= now) {
          const previousRound = state.topicEvent!.roundIndex;
          state.topicEvent = undefined;
          state.deadlineAt = undefined;
          const nextRound = activeRound(pack, state);
          if (nextRound > previousRound) beginRoundLoading(state, pack, nextRound, "board", now);
          else state.phase = "board";
          changed = true;
        }
        if (state.phase === "presentation" && state.deadlineAt && state.deadlineAt <= now) {
          state.phase = "board";
          state.presentationStartedAt = undefined;
          state.deadlineAt = undefined;
          changed = true;
        }
        if (
          state.phase === "board" &&
          state.pickerRouletteEndsAt &&
          state.pickerRouletteEndsAt <= now
        ) {
          state.pickerRouletteStartedAt = undefined;
          state.pickerRouletteEndsAt = undefined;
          changed = true;
        }
        if (
          state.phase === "question" &&
          question &&
          state.buzzResolveAt &&
          state.buzzResolveAt <= now
        ) {
          state.buzzWinnerId = chooseBuzzWinner(state.buzzCandidates, state.buzzSeed ?? room.id);
          audit = { candidates: [...state.buzzCandidates], winnerId: state.buzzWinnerId };
          state.buzzResolveAt = undefined;
          state.buzzCandidates = [];
          if (state.buzzWinnerId && !state.hostEnabled)
            state.deadlineAt = now + question.answerTimeSeconds * 1000;
          changed = true;
        }
        if (
          (state.phase === "question" || state.phase === "result") &&
          state.deadlineAt &&
          state.deadlineAt <= now
        ) {
          if (state.phase === "question" && question) {
            if (state.hostEnabled) {
              state.phase = "review";
              state.deadlineAt = undefined;
              state.buzzResolveAt = undefined;
              state.buzzCandidates = [];
            } else await this.finish(tx, state, question, now, room.participants);
          } else {
            const previousRound = activeRound(pack, state);
            const topicVote = openTopicMinigameVote(
              state,
              pack,
              room.participants.filter((person) => person.role === "player"),
              room.gameMode === "team",
            );
            state.currentQuestionId = undefined;
            state.openedAt = undefined;
            state.buzzOpensAt = undefined;
            state.readingEndsAt = undefined;
            state.bonusOpensAt = undefined;
            state.bonusSkippedPlayers = [];
            state.audioSkippedPlayers = [];
            state.activePowers = {};
            state.frozenPlayerId = undefined;
            state.deadlineAt = undefined;
            state.buzzWinnerId = undefined;
            state.result = undefined;
            state.responses = [];
            const nextRound = activeRound(pack, state);
            if (topicVote) state.phase = "minigame-vote";
            else if (nextRound > previousRound)
              beginRoundLoading(state, pack, nextRound, "board", now);
            else state.phase = "board";
          }
          changed = true;
        }
        if (changed) await this.saveState(tx, room, state, "timer", audit);
        wakeup = this.nextWakeup(state);
      });
    } catch (error) {
      this.logger.error(`Timer transition failed for room ${roomId}: ${String(error)}`);
      this.schedule(roomId, Date.now() + 1000);
      return;
    }
    this.schedule(roomId, wakeup);
    if (changed) this.notify(roomId);
  }

  async command(
    roomId: string,
    participantId: string,
    input: RoomCommandInput,
  ): Promise<RoomCommandAck> {
    const receivedAt = Date.now();
    if (
      !input ||
      typeof input.id !== "string" ||
      input.id.length < 1 ||
      input.id.length > 80 ||
      ![
        "final",
        "start",
        "set-victory-rules",
        "load-progress",
        "force-loading",
        "pick",
        "skip-topic",
        "offer-duel",
        "accept-duel",
        "decline-duel",
        "cancel-duel",
        "finish-duel",
        "vote-minigame",
        "finish-minigame",
        "buzz",
        "skip",
        "answer",
        "judge-answer",
        "finish-review",
        "next",
        "set-score",
        "set-team-score",
        "change-seat",
        "rename-team",
        "use-power",
        "skip-bonuses",
        "skip-audio",
      ].includes(input.type)
    )
      return { ok: false, error: "Неверная команда", serverReceivedAt: receivedAt };
    await this.advance(roomId);
    let wakeup: number | undefined;
    const ack = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, roomId);
      const room = await tx.gameRoom.findUniqueOrThrow({
        where: { id: roomId },
        include: { participants: true },
      });
      const participant = room.participants.find((item) => item.id === participantId);
      if (!participant) throw new UnauthorizedException("Участник не найден");
      const prior = await tx.gameCommand.findUnique({
        where: { roomId_participantId_commandId: { roomId, participantId, commandId: input.id } },
      });
      if (prior) return prior.response as unknown as RoomCommandAck;
      const state = parseState(room);
      const pack = parsePack(room);
      const now = Date.now();
      const canControl = participant.role === "host" || participant.id === room.creatorId;
      let error: string | undefined;
      let queued = false;
      let delta = 0;
      let judgedScore: { participantId: string; delta: number } | undefined;
      let scoreUpdate: { participantId: string; score: number } | undefined;
      let seatUpdate:
        { role: "host" | "player"; teamId: string | null; seatNumber: number | null } | undefined;
      if (input.type === "final") {
        if (
          state.phase !== "final" ||
          !state.final ||
          !input.finalCommand ||
          (participant.role !== "player" && input.finalCommand.type !== "continue") ||
          (input.finalCommand.type === "continue" && !canControl)
        )
          error = "Недоступное действие финала";
        else {
          const changes = progressRoomFinal(state, pack, participant.id, input.finalCommand, now);
          for (const change of changes)
            await tx.gameParticipant.update({
              where: { id: change.id },
              data: { score: { increment: change.delta } },
            });
        }
      } else if (state.phase === "final") {
        error = "Сейчас идёт финал";
      } else if (
        state.duel &&
        ["pick", "skip-topic", "set-score", "set-team-score"].includes(input.type)
      ) {
        error = "Сначала заверши дуэль или отзови вызов";
      } else if (
        ["offer-duel", "accept-duel", "decline-duel", "cancel-duel", "finish-duel"].includes(
          input.type,
        )
      ) {
        const previousDuel = state.duel ? { ...state.duel } : undefined;
        const previousChallenges = { ...state.duelChallenges };
        const previousPhase = state.phase;
        const previousDeadline = state.deadlineAt;
        try {
          if (
            input.type === "offer-duel" &&
            pack.topics.every((t) => t.questions.every((q) => state.played.includes(q.id)))
          )
            throw new Error("Игра уже завершена");
          applyRoomDuel(
            state,
            input,
            participant,
            room.participants
              .filter((p) => p.role === "player")
              .map((p) => ({ ...p, accountId: room.gameMode === "team" ? p.teamId : undefined })),
            Boolean(state.pickerRouletteEndsAt && state.pickerRouletteEndsAt > now),
          );
          if (input.type === "accept-duel") {
            if (!this.topicGames) throw new Error("Сервис дуэлей недоступен");
            this.topicGames.duelView(roomId, state.duel!, room.participants);
          }
        } catch (cause) {
          state.duel = previousDuel;
          state.duelChallenges = previousChallenges;
          state.phase = previousPhase;
          state.deadlineAt = previousDeadline;
          error = cause instanceof Error ? cause.message : "Не удалось начать дуэль";
        }
      } else if (input.type === "load-progress") {
        const progress = input.progress;
        if (state.phase !== "loading") error = "Раунд сейчас не загружается";
        else if (!Number.isInteger(progress) || progress! < 0 || progress! > 100)
          error = "Прогресс должен быть от 0 до 100%";
        else {
          state.loadingProgress ??= {};
          state.loadingProgress[participantId] = Math.max(
            state.loadingProgress[participantId] ?? 0,
            progress!,
          );
          if (room.participants.every((person) => state.loadingProgress?.[person.id] === 100))
            completeRoundLoading(state, pack, now);
        }
      } else if (input.type === "force-loading") {
        if (!canControl) error = "Продолжить может только создатель или ведущий";
        else if (state.phase !== "loading") error = "Раунд сейчас не загружается";
        else if (now - (state.loadingStartedAt ?? now) < 30_000)
          error = "Подожди участников ещё немного";
        else completeRoundLoading(state, pack, now);
      } else if (input.type === "change-seat") {
        if (state.phase !== "lobby") error = "Менять место можно только до начала игры";
        else if (input.role !== "host" && input.role !== "player") error = "Выбери роль";
        else if (input.role === "host") {
          if (!hostIsEnabled(room)) error = "В этой комнате нет ведущего";
          else if (
            room.participants.some(
              (person) => person.role === "host" && person.id !== participantId,
            )
          )
            error = "Место ведущего уже занято";
          else if (participant.role === "host") error = "Ты уже ведущий";
          else seatUpdate = { role: "host", teamId: null, seatNumber: null };
        } else {
          const otherPlayers = room.participants.filter(
            (person) => person.role === "player" && person.id !== participantId,
          );
          if (otherPlayers.length >= room.maxPlayers) error = "За столом нет свободных мест";
          else {
            const currentTeam =
              participant.role === "player" && participant.teamId
                ? Number(participant.teamId.replace("team-", ""))
                : undefined;
            const placement = chooseTeamSeat(room, otherPlayers, input.teamNumber ?? currentTeam);
            if (placement.error) error = placement.error;
            else {
              const seat = chooseSeatNumber(
                otherPlayers,
                placement.teamId,
                room.gameMode === "team" ? room.maxPlayers / room.teamCount : room.maxPlayers,
                input.seatNumber ??
                  (participant.role === "player" && participant.teamId === placement.teamId
                    ? (participant.seatNumber ?? undefined)
                    : undefined),
              );
              if (seat.error) error = seat.error;
              else if (
                participant.role === "player" &&
                participant.teamId === placement.teamId &&
                participant.seatNumber === seat.seatNumber
              )
                error = "Ты уже на этом месте";
              else
                seatUpdate = {
                  role: "player",
                  teamId: placement.teamId,
                  seatNumber: seat.seatNumber!,
                };
            }
          }
        }
      } else if (input.type === "rename-team") {
        const name =
          typeof input.teamName === "string" ? input.teamName.trim().replace(/\s+/g, " ") : "";
        if (state.phase !== "lobby") error = "Переименовать команду можно только до начала игры";
        else if (room.gameMode !== "team") error = "В этой комнате нет команд";
        else if (
          !Number.isSafeInteger(input.teamNumber) ||
          input.teamNumber! < 1 ||
          input.teamNumber! > room.teamCount
        )
          error = "Выбери существующую команду";
        else if (!name || name.length > 32) error = "Название команды: от 1 до 32 символов";
        else state.teamNames = { ...state.teamNames, [`team-${input.teamNumber}`]: name };
      } else if (input.type === "set-victory-rules") {
        if (!canControl) error = "Настройки победы меняет только создатель или ведущий";
        else if (state.phase !== "lobby")
          error = "Правила победы можно менять только до начала игры";
        else if (!isVictoryRules(input.victory))
          error = "Выбери режим победы и хотя бы одну допустимую номинацию";
        else state.victory = structuredClone(input.victory);
      } else if (input.type === "start") {
        if (!canControl) error = "Только создатель или ведущий запускает игру";
        else if (state.phase !== "lobby") error = "Игра уже началась";
        else if (state.hostEnabled && !room.participants.some((person) => person.role === "host"))
          error = "Для игры с ведущим сначала займи место ведущего";
        else if (
          room.gameMode === "team" &&
          Array.from({ length: room.teamCount }, (_, index) => `team-${index + 1}`).some(
            (teamId) =>
              room.participants.filter((item) => item.role === "player" && item.teamId === teamId)
                .length < 2,
          )
        )
          error = "Для начала нужны хотя бы два игрока в каждой команде";
        else if (room.participants.filter((item) => item.role === "player").length < 2)
          error = "Для начала нужны хотя бы два игрока";
        else {
          const candidates = openingPickerCandidates(room.participants, room.gameMode);
          state.pickerId = candidates[randomInt(candidates.length)].id;
          beginRoundLoading(state, pack, activeRound(pack, state), "presentation", now);
        }
      } else if (input.type === "vote-minigame") {
        if (state.phase !== "minigame-vote" || !state.topicEvent) error = "Сейчас нет голосования";
        else if (input.topicId !== state.topicEvent.topicId)
          error = "Это голосование уже завершено";
        else if (participant.role !== "player") error = "Ведущий не голосует";
        else {
          try {
            const event = castTopicMinigameVote(
              state.topicEvent,
              participantId,
              input.minigame ?? "",
              randomInt,
            );
            if (event.selected) {
              if (!this.topicGames) throw new Error("Сервис мини-игр недоступен");
              this.topicGames.ensure(roomId, event, room.participants);
              state.phase = "minigame";
              state.deadlineAt = now + 1000;
            }
            state.topicEvent = event;
          } catch (cause) {
            error = cause instanceof Error ? cause.message : "Не удалось принять голос";
          }
        }
      } else if (input.type === "finish-minigame") {
        if (!canControl) error = "Продолжить может ведущий или создатель";
        else if (state.phase !== "minigame-result") error = "Сначала дождись результата мини-игры";
        else {
          const previousRound = state.topicEvent!.roundIndex;
          state.topicEvent = undefined;
          state.deadlineAt = undefined;
          const nextRound = activeRound(pack, state);
          if (nextRound > previousRound) beginRoundLoading(state, pack, nextRound, "board", now);
          else state.phase = "board";
        }
      } else if (input.type === "skip-topic") {
        const previousRound = activeRound(pack, state);
        const outcome = skipRoomTopic(
          state,
          pack,
          previousRound,
          input.topicId,
          participant,
          room.participants.filter((person) => person.role === "player").map((person) => person.id),
          hostIsEnabled(room),
          now,
        );
        error = outcome.error;
        if (outcome.skipped) {
          const nextRound = activeRound(pack, state);
          if (nextRound > previousRound) beginRoundLoading(state, pack, nextRound, "board", now);
        }
      } else if (input.type === "pick") {
        const question = input.questionId ? findQuestion(pack, input.questionId) : undefined;
        const topic = pack.topics.find((item) =>
          item.questions.some((candidate) => candidate.id === input.questionId),
        );
        const nextQuestionId =
          topic?.direction === "reverse"
            ? topic.questions.filter((item) => !state.played.includes(item.id)).at(-1)?.id
            : topic?.questions.find((item) => !state.played.includes(item.id))?.id;
        if (participant.id !== state.pickerId) error = "Сейчас вопрос выбирает другой игрок";
        else if (state.phase !== "board") error = "Сейчас нельзя выбрать вопрос";
        else if (state.pickerRouletteEndsAt && now < state.pickerRouletteEndsAt)
          error = "Дождись окончания выбора игрока";
        else if (!question || state.played.includes(question.id)) error = "Вопрос недоступен";
        else if (topic?.isFinal) error = "Финальная тема выбирается голосованием";
        else if (!topic || (topic.roundIndex ?? 0) !== activeRound(pack, state))
          error = "Этот раунд ещё не открыт";
        else if (topic.ordered && question.id !== nextQuestionId)
          error = "Вопросы этой темы идут по порядку";
        else {
          state.phase = "question";
          state.topicSkipVotes = {};
          state.currentQuestionId = question.id;
          state.played.push(question.id);
          state.openedAt = now;
          state.readingEndsAt = now + questionReadingDurationMs(question);
          const hasAvailablePower =
            question.questionMedia?.kind !== "audio" &&
            state.powersEnabled &&
            Object.values(state.powersByPlayer ?? {}).some(
              (powers) => powers.double > 0 || powers.shield > 0 || powers.freeze > 0,
            );
          state.bonusOpensAt = hasAvailablePower ? state.readingEndsAt : undefined;
          state.buzzOpensAt = state.readingEndsAt + (hasAvailablePower ? 10000 : 0);
          state.deadlineAt = state.buzzOpensAt + question.answerTimeSeconds * 1000;
          state.buzzRemainingMs = undefined;
          state.buzzWinnerId = undefined;
          state.buzzCandidates = [];
          state.skippedPlayers = [];
          state.bonusSkippedPlayers = [];
          state.audioSkippedPlayers = [];
          state.activePowers = {};
          state.frozenPlayerId = undefined;
          state.buzzSeed = randomBytes(16).toString("hex");
          state.buzzResolveAt = undefined;
          state.responses = [];
          state.result = undefined;
          state.lastJudgedCorrectId = undefined;
        }
      } else if (input.type === "buzz") {
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        if (participant.role !== "player") error = "Ведущий не отвечает";
        else if (state.phase !== "question" || question?.answerMode !== "buzzer")
          error = "Кнопка сейчас недоступна";
        else if (
          !state.buzzOpensAt ||
          now < state.buzzOpensAt ||
          (state.deadlineAt && now >= state.deadlineAt)
        )
          error = "Кнопка ещё не открыта или время истекло";
        else if (
          state.buzzWinnerId ||
          state.buzzCandidates.some((candidate) => candidate.participantId === participant.id)
        )
          error = "Нажатие уже принято";
        else if (state.skippedPlayers?.includes(participant.id)) error = "Ты уже пропустил вопрос";
        else if (state.hostEnabled && !eligibleHostBuzzPlayers(state, [participant]).length)
          error = "Ты уже ответил на этот вопрос";
        else if (state.frozenPlayerId === participant.id) error = "Ты заморожен на этот вопрос";
        else {
          pauseHostBuzzer(state, now);
          state.buzzCandidates.push({ participantId, receivedAt });
          state.buzzResolveAt ??= now + ARBITRATION_MS;
          queued = true;
        }
      } else if (input.type === "skip") {
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        if (participant.role !== "player") error = "Ведущий не пропускает вопрос";
        else if (state.phase !== "question" || question?.answerMode !== "buzzer")
          error = "Сейчас нельзя пропустить вопрос";
        else if (
          !state.buzzOpensAt ||
          now < state.buzzOpensAt ||
          (state.deadlineAt && now >= state.deadlineAt)
        )
          error = "Пропуск пока недоступен";
        else if (state.buzzWinnerId || state.buzzCandidates.length)
          error = "Кнопка ответа уже нажата";
        else if (state.skippedPlayers?.includes(participantId)) error = "Ты уже пропустил вопрос";
        else {
          state.skippedPlayers ??= [];
          state.skippedPlayers.push(participantId);
          const players = room.participants.filter((item) => item.role === "player");
          if (
            state.hostEnabled
              ? !eligibleHostBuzzPlayers(state, players).length
              : players.every((item) => state.skippedPlayers!.includes(item.id))
          ) {
            if (state.hostEnabled) {
              state.phase = "review";
              state.deadlineAt = undefined;
            } else {
              await this.finish(tx, state, question, now, room.participants);
              state.result!.skipped = true;
            }
          }
        }
      } else if (input.type === "use-power") {
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        const power = input.power;
        if (participant.role !== "player") error = "Ведущий не использует бонусы";
        else if (
          !state.powersEnabled ||
          state.phase !== "question" ||
          !question ||
          !state.bonusOpensAt ||
          now < state.bonusOpensAt ||
          !state.buzzOpensAt ||
          now >= state.buzzOpensAt
        )
          error = "Окно бонусов закрыто";
        else if (power !== "double" && power !== "shield" && power !== "freeze")
          error = "Неизвестный бонус";
        else {
          state.powersByPlayer ??= {};
          const powers = (state.powersByPlayer[participantId] ??= {
            double: 0,
            shield: 0,
            freeze: 0,
          });
          if (powers[power] < 1) error = "Такого бонуса нет";
          else if (power === "freeze") {
            const target = room.participants.find((item) => item.id === input.targetParticipantId);
            if (question.answerMode !== "buzzer")
              error = "Заморозка работает только в вопросе на скорость";
            else if (!target || target.role !== "player" || target.id === participantId)
              error = "Выбери другого игрока";
            else if (room.gameMode === "team" && target.teamId === participant.teamId)
              error = "Нельзя заморозить союзника";
            else if (state.frozenPlayerId) error = "Игрок уже заморожен";
            else {
              powers.freeze -= 1;
              state.frozenPlayerId = target.id;
            }
          } else {
            state.activePowers ??= {};
            const active = (state.activePowers[participantId] ??= {});
            if (active[power]) error = "Бонус уже использован";
            else {
              powers[power] -= 1;
              active[power] = true;
            }
          }
        }
      } else if (input.type === "skip-bonuses") {
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        if (participant.role !== "player") error = "Ведущий не пропускает бонусы";
        else if (
          state.phase !== "question" ||
          !question ||
          !state.bonusOpensAt ||
          now < state.bonusOpensAt ||
          !state.buzzOpensAt ||
          now >= state.buzzOpensAt
        )
          error = "Окно бонусов закрыто";
        else if (state.bonusSkippedPlayers?.includes(participantId)) error = "Ты уже готов";
        else {
          state.bonusSkippedPlayers ??= [];
          state.bonusSkippedPlayers.push(participantId);
          const players = room.participants.filter((item) => item.role === "player");
          if (players.every((item) => state.bonusSkippedPlayers!.includes(item.id))) {
            state.buzzOpensAt = now;
            state.deadlineAt = now + question.answerTimeSeconds * 1000;
            state.bonusOpensAt = undefined;
          }
        }
      } else if (input.type === "skip-audio") {
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        if (
          state.phase !== "question" ||
          question?.questionMedia?.kind !== "audio" ||
          !state.readingEndsAt ||
          now >= state.readingEndsAt
        )
          error = "Прослушивание уже завершилось";
        else if (state.audioSkippedPlayers?.includes(participantId)) error = "Ты уже проголосовал";
        else
          voteToSkipAudio(
            state,
            room.participants.map((person) => person.id),
            participantId,
            now,
            question.answerTimeSeconds,
          );
      } else if (input.type === "answer") {
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        const answer = input.answer;
        if (participant.role !== "player") error = "Ведущий не отвечает";
        else if (state.phase !== "question" || !question) error = "Сейчас нет вопроса";
        else if (
          !state.buzzOpensAt ||
          now < state.buzzOpensAt ||
          (state.deadlineAt && now >= state.deadlineAt)
        )
          error = "Время ответа ещё не наступило или истекло";
        else if (question.answerMode === "buzzer" && state.buzzWinnerId !== participant.id)
          error = "Отвечает игрок, первым нажавший кнопку";
        else if (state.responses.some((response) => response.participantId === participant.id))
          error = "Ответ уже принят";
        else if (
          question.type === "numeric-closest" &&
          (typeof answer !== "number" || !Number.isFinite(answer) || Math.abs(answer) > 1000000000)
        )
          error = "Введи число";
        else if (
          question.type === "puzzle" &&
          (!Array.isArray(answer) ||
            answer.length !== (question.puzzleGridSize ?? 0) ** 2 ||
            !answer.every(
              (tile) =>
                typeof tile === "number" &&
                Number.isInteger(tile) &&
                tile >= 0 &&
                tile < answer.length,
            ) ||
            new Set(answer.map(String)).size !== answer.length)
        )
          error = "Неверный порядок фрагментов";
        else if (
          question.type === "matching" &&
          (!Array.isArray(answer) ||
            answer.length !== question.matchingPairs?.length ||
            !answer.every(
              (factIndex) =>
                typeof factIndex === "number" &&
                Number.isInteger(factIndex) &&
                factIndex >= 0 &&
                factIndex < answer.length,
            ) ||
            new Set(answer.map(String)).size !== answer.length)
        )
          error = "Соотнеси каждый факт с элементом";
        else if (
          question.type === "spot-difference" &&
          (!Array.isArray(answer) ||
            answer.length !== question.differenceTargets?.length ||
            !answer.every(
              (point) =>
                typeof point === "object" &&
                point !== null &&
                "x" in point &&
                "y" in point &&
                Number.isFinite(point.x) &&
                Number.isFinite(point.y) &&
                point.x >= 0 &&
                point.x <= 1 &&
                point.y >= 0 &&
                point.y <= 1,
            ))
        )
          error = "Отметь все отличия на изображении";
        else if (
          Array.isArray(answer) &&
          question.type !== "puzzle" &&
          question.type !== "matching" &&
          question.type !== "spot-difference"
        )
          error = "Неверный формат ответа";
        else if (
          typeof answer !== "string" &&
          typeof answer !== "number" &&
          !Array.isArray(answer) &&
          !(
            typeof answer === "object" &&
            answer !== null &&
            (("x" in answer && "y" in answer) || ("lat" in answer && "lng" in answer))
          )
        )
          error = "Неверный формат ответа";
        else if (typeof answer === "string" && answer.length > 1000)
          error = "Ответ слишком длинный";
        else if (
          typeof answer === "number" &&
          question.type !== "numeric-closest" &&
          !Number.isSafeInteger(answer)
        )
          error = "Неверный формат ответа";
        else {
          const correct =
            question.type === "numeric-closest" ? false : isCorrectAnswer(question, answer);
          const active = state.activePowers?.[participantId];
          const measuredDistance =
            question.type === "geo" &&
            question.geoMapMode !== "image" &&
            question.geoTarget &&
            typeof answer === "object" &&
            answer !== null &&
            "lat" in answer
              ? distanceKm(question.geoTarget, answer)
              : undefined;
          const measuredPercent =
            question.type === "geo" &&
            question.geoMapMode === "image" &&
            question.imageTarget &&
            typeof answer === "object" &&
            answer !== null &&
            "x" in answer
              ? Math.hypot(question.imageTarget.x - answer.x, question.imageTarget.y - answer.y) *
                100
              : undefined;
          const price = question.value * (question.type === "risk" ? 2 : 1);
          const earned =
            measuredDistance !== undefined
              ? Math.round(price * Math.max(0, 1 - measuredDistance / 2500))
              : measuredPercent !== undefined
                ? Math.round(price * Math.max(0, 1 - measuredPercent / 40))
                : correct
                  ? price
                  : 0;
          delta =
            state.hostEnabled || question.type === "numeric-closest"
              ? 0
              : earned > 0
                ? earned * (active?.double ? 2 : 1)
                : active?.shield
                  ? 0
                  : -price;
          const response: RoomResponse = {
            participantId,
            answer,
            correct: state.hostEnabled ? false : correct,
            scoreDelta: delta,
            shielded:
              question.type !== "numeric-closest" && earned === 0 && Boolean(active?.shield),
            distanceKm: measuredDistance,
            distancePercent: measuredPercent,
          };
          if (!state.hostEnabled) rewardCorrectAnswer(state, response);
          state.responses.push(response);
          if (
            question.answerMode === "buzzer" ||
            state.responses.length >=
              room.participants.filter((item) => item.role === "player").length
          ) {
            if (state.hostEnabled) {
              state.phase = "review";
              state.deadlineAt = undefined;
            } else await this.finish(tx, state, question, now, room.participants);
          }
        }
      } else if (input.type === "finish-review") {
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        if (participant.role !== "host" || !state.hostEnabled)
          error = "Решение принимает только ведущий";
        else if (!["question", "review"].includes(state.phase) || !question)
          error = "Сейчас нет вопроса для завершения";
        else if (question.questionMedia?.kind === "audio" && now < (state.readingEndsAt ?? 0))
          error = "Дождись окончания музыкального фрагмента";
        else if (state.responses.some((item) => !item.judged))
          error = "Сначала оцени полученные ответы";
        else {
          await this.finish(tx, state, question, now, room.participants);
          if (!state.responses.length) state.result!.skipped = true;
        }
      } else if (input.type === "judge-answer") {
        const question = state.currentQuestionId
          ? findQuestion(pack, state.currentQuestionId)
          : undefined;
        let response = state.responses.find(
          (item) => item.participantId === input.targetParticipantId,
        );
        const target = room.participants.find((item) => item.id === input.targetParticipantId);
        const multiplier = input.scoreMultiplier ?? 1;
        if (participant.role !== "host" || !state.hostEnabled)
          error = "Решение принимает только ведущий";
        else if (!["question", "review"].includes(state.phase) || !question)
          error = "Сейчас нет ответа на проверке";
        else if (question.questionMedia?.kind === "audio" && now < (state.readingEndsAt ?? 0))
          error = "Дождись окончания музыкального фрагмента";
        else if (!target || target.role !== "player") error = "Игрок не найден";
        else if (response?.judged) error = "Ответ уже оценён";
        else if (
          question.answerMode === "buzzer" &&
          state.buzzWinnerId &&
          state.buzzWinnerId !== target.id
        )
          error = "Сейчас отвечает другой игрок";
        else if (
          input.answer !== undefined &&
          (typeof input.answer !== "string" || input.answer.length > 200)
        )
          error = "Устный ответ слишком длинный или имеет неверный формат";
        else if (input.verdict !== "correct" && input.verdict !== "incorrect")
          error = "Выбери результат проверки";
        else if (![0.5, 1, 2].includes(multiplier)) error = "Недопустимый множитель очков";
        else {
          response = getOrCreateHostResponse(
            state,
            target!.id,
            typeof input.answer === "string" ? input.answer.trim() : "",
          );
          const active = state.activePowers?.[response.participantId];
          const correct = input.verdict === "correct";
          response.correct = correct;
          response.judged = true;
          if (correct) state.lastJudgedCorrectId = response.participantId;
          response.scoreDelta = hostJudgedDelta(question, correct, multiplier, active);
          response.shielded = !correct && Boolean(active?.shield);
          judgedScore = { participantId: response.participantId, delta: response.scoreDelta };
          rewardCorrectAnswer(state, response);
          if (question.answerMode === "buzzer") {
            if (correct || !resumeHostBuzzer(state, room.participants, now))
              await this.finish(tx, state, question, now, room.participants);
          } else if (
            state.responses.every((item) => item.judged) &&
            room.participants
              .filter((item) => item.role === "player")
              .every((item) =>
                state.responses.some((response) => response.participantId === item.id),
              )
          )
            await this.finish(tx, state, question, now, room.participants);
        }
      } else if (input.type === "next") {
        if (!canControl) error = "Только создатель или ведущий завершает вопрос";
        else if (state.phase !== "result") error = "Сначала дождись результата";
        else {
          const previousRound = activeRound(pack, state);
          const topicVote = openTopicMinigameVote(
            state,
            pack,
            room.participants.filter((person) => person.role === "player"),
            room.gameMode === "team",
          );
          state.currentQuestionId = undefined;
          state.openedAt = undefined;
          state.buzzOpensAt = undefined;
          state.readingEndsAt = undefined;
          state.bonusOpensAt = undefined;
          state.bonusSkippedPlayers = [];
          state.audioSkippedPlayers = [];
          state.activePowers = {};
          state.frozenPlayerId = undefined;
          state.deadlineAt = undefined;
          state.buzzWinnerId = undefined;
          state.responses = [];
          state.result = undefined;
          const nextRound = activeRound(pack, state);
          if (topicVote) state.phase = "minigame-vote";
          else if (nextRound > previousRound)
            beginRoundLoading(state, pack, nextRound, "board", now);
          else state.phase = "board";
        }
      } else if (input.type === "set-score") {
        const target = room.participants.find((item) => item.id === input.targetParticipantId);
        if (participant.role !== "host") error = "Только ведущий меняет очки";
        else if (room.gameMode !== "solo") error = "В командной игре меняется счёт команды";
        else if (!target || target.role !== "player") error = "Игрок не найден";
        else if (
          !Number.isSafeInteger(input.score) ||
          input.score! < -100000 ||
          input.score! > 1000000
        )
          error = "Укажи целое количество очков";
        else scoreUpdate = { participantId: target.id, score: input.score! };
      } else if (input.type === "set-team-score") {
        if (participant.role !== "host") error = "Только ведущий меняет очки";
        else if (room.gameMode !== "team")
          error = "Командный счёт доступен только в командной игре";
        else if (
          !Number.isInteger(input.teamNumber) ||
          input.teamNumber! < 1 ||
          input.teamNumber! > room.teamCount
        )
          error = "Выбери существующую команду";
        else if (
          !Number.isSafeInteger(input.score) ||
          input.score! < -100000 ||
          input.score! > 1000000
        )
          error = "Укажи целое количество очков";
        else {
          const update = teamScoreAdjustment(
            room.participants,
            `team-${input.teamNumber}`,
            input.score!,
          );
          if (!update) error = "В команде нет игроков";
          else if (update.score < -100000 || update.score > 1000000)
            error = "Командный счёт выходит за допустимые пределы";
          else scoreUpdate = update;
        }
      }
      const response: RoomCommandAck = error
        ? { ok: false, error, revision: room.revision, serverReceivedAt: receivedAt }
        : { ok: true, revision: room.revision + 1, serverReceivedAt: receivedAt, queued };
      if (!error) {
        if (seatUpdate)
          await tx.gameParticipant.update({ where: { id: participantId }, data: seatUpdate });
        if (scoreUpdate)
          await tx.gameParticipant.update({
            where: { id: scoreUpdate.participantId },
            data: { score: scoreUpdate.score },
          });
        if (delta)
          await tx.gameParticipant.update({
            where: { id: participantId },
            data: { score: { increment: delta } },
          });
        if (judgedScore?.delta)
          await tx.gameParticipant.update({
            where: { id: judgedScore.participantId },
            data: { score: { increment: judgedScore.delta } },
          });
        await this.saveState(tx, room, state, input.type);
        wakeup = this.nextWakeup(state);
      }
      await tx.gameCommand.create({
        data: {
          id: randomUUID(),
          roomId,
          participantId,
          commandId: input.id,
          response: response as unknown as Prisma.InputJsonValue,
        },
      });
      return response;
    });
    if (ack.ok) {
      this.schedule(roomId, wakeup);
      this.notify(roomId);
    }
    return ack;
  }
}
