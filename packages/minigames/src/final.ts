type MediaRef = { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };

export const FINAL_RESULT_SECONDS = 7;

export interface FinalQuestion {
  id: string;
  type: "text" | "choice";
  prompt: string;
  options: string[];
  answer: string;
  acceptedAnswers?: string[];
  answerTimeSeconds?: number;
  questionMedia?: MediaRef;
}
export interface FinalTopic {
  id: string;
  title: string;
  question: FinalQuestion;
}
export interface FinalPlayer {
  id: string;
  name: string;
  score: number;
  memberIds: string[];
}
export interface FinalState {
  phase: "intro" | "vote" | "reveal" | "bet" | "answer" | "result" | "done";
  deadlineAt: number;
  topics: { id: string; title: string }[];
  players: FinalPlayer[];
  votes: Record<string, string>;
  bets: Record<string, number>;
  responses: Record<string, { answer: string; correct: boolean; delta: number }>;
  selectedId?: string;
}
export type FinalCommand =
  | { type: "vote"; topicId: string }
  | { type: "bet"; stake: number }
  | { type: "answer"; answer: string }
  | { type: "tick" }
  | { type: "continue" };

export function createFinal(topics: FinalTopic[], players: FinalPlayer[], now: number): FinalState {
  return {
    phase: "intro",
    deadlineAt: now + 4000,
    topics: topics.map(({ id, title }) => ({ id, title })),
    players,
    votes: {},
    bets: {},
    responses: {},
  };
}
export function finalLeaders(topics: { id: string }[], votes: Record<string, string>): string[] {
  const counts = topics.map((t) => ({
    id: t.id,
    count: Object.values(votes).filter((id) => id === t.id).length,
  }));
  const maximum = Math.max(...counts.map((t) => t.count));
  return counts.filter((t) => t.count === maximum).map((t) => t.id);
}
const normalize = (text: string) =>
  text
    .trim()
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ");
export function advanceFinal(
  current: FinalState,
  topics: FinalTopic[],
  memberId: string | null,
  command: FinalCommand,
  now: number,
  roll: number,
): FinalState {
  if (command.type === "tick" && now < current.deadlineAt) return current;
  const state = structuredClone(current);
  const player = state.players.find((p) => p.memberIds.includes(memberId ?? ""));
  const expired = now >= state.deadlineAt;
  if (
    command.type === "vote" &&
    state.phase === "vote" &&
    !expired &&
    player &&
    state.topics.some((t) => t.id === command.topicId)
  )
    state.votes[player.id] = command.topicId;
  if (
    command.type === "bet" &&
    state.phase === "bet" &&
    !expired &&
    player &&
    state.bets[player.id] === undefined &&
    Number.isSafeInteger(command.stake) &&
    command.stake >= 1 &&
    command.stake <= Math.max(1, player.score)
  )
    state.bets[player.id] = command.stake;
  if (
    command.type === "answer" &&
    state.phase === "answer" &&
    !expired &&
    player &&
    !state.responses[player.id] &&
    typeof command.answer === "string" &&
    command.answer.trim() &&
    command.answer.length <= 2000
  ) {
    const q = topics.find((t) => t.id === state.selectedId)!.question;
    if (q.type !== "choice" || q.options.includes(command.answer)) {
      const correct = [q.answer, ...(q.acceptedAnswers ?? [])].some(
        (answer) => normalize(answer) === normalize(command.answer),
      );
      state.responses[player.id] = {
        answer: command.answer,
        correct,
        delta: state.bets[player.id] * (correct ? 1 : -1),
      };
    }
  }
  const all = (entries: object) => state.players.every((p) => Object.hasOwn(entries, p.id));
  if (state.phase === "intro" && expired) {
    state.phase = "vote";
    state.deadlineAt = now + 30000;
  } else if (state.phase === "vote" && (expired || all(state.votes))) {
    const leaders = finalLeaders(state.topics, state.votes);
    state.selectedId =
      leaders[Math.min(leaders.length - 1, Math.max(0, Math.floor(roll * leaders.length)))];
    state.phase = "reveal";
    state.deadlineAt = now + 2000;
  } else if (state.phase === "reveal" && expired) {
    state.phase = "bet";
    state.deadlineAt = now + 30000;
  } else if (state.phase === "bet" && (expired || all(state.bets))) {
    for (const p of state.players) state.bets[p.id] ??= 1;
    state.phase = "answer";
    state.deadlineAt =
      now +
      (topics.find((t) => t.id === state.selectedId)!.question.answerTimeSeconds ?? 30) * 1000;
  } else if (state.phase === "answer" && (expired || all(state.responses))) {
    for (const p of state.players)
      state.responses[p.id] ??= { answer: "", correct: false, delta: -state.bets[p.id] };
    state.phase = "result";
    state.deadlineAt = now + FINAL_RESULT_SECONDS * 1000;
  } else if (state.phase === "result" && (expired || command.type === "continue"))
    state.phase = "done";
  return state;
}
export function hidesFinalScores(
  final: Pick<FinalState, "phase"> | undefined,
  victory?: { mode: "score" | "achievements" },
) {
  return !!final && (victory?.mode ?? "score") === "score";
}

export function publicFinal(
  state: FinalState,
  topics: FinalTopic[],
  memberId: string | null,
  scoresHidden = false,
) {
  const self = state.players.find((p) => p.memberIds.includes(memberId ?? ""));
  const selected = topics.find((t) => t.id === state.selectedId);
  const reveal = state.phase === "result" || state.phase === "done";
  const { answer, acceptedAnswers, ...question } = selected?.question ?? ({} as FinalQuestion);
  void acceptedAnswers;
  const responses: Record<string, { answer: string; correct: boolean; delta?: number }> = {};
  if (reveal)
    for (const [id, response] of Object.entries(state.responses))
      responses[id] = {
        answer: response.answer,
        correct: response.correct,
        ...(!scoresHidden ? { delta: response.delta } : {}),
      };
  return {
    ...state,
    scoresHidden,
    topics: state.topics.map((topic) => ({
      ...topic,
      questionType: topics.find((t) => t.id === topic.id)?.question.type,
    })),
    bets:
      reveal && !scoresHidden
        ? state.bets
        : !reveal && self && state.bets[self.id] !== undefined
          ? { [self.id]: state.bets[self.id] }
          : {},
    responses,
    betIds: Object.keys(state.bets),
    betCount: Object.keys(state.bets).length,
    answerCount: Object.keys(state.responses).length,
    answeredIds: Object.keys(state.responses),
    question: state.phase === "answer" || reveal ? question : undefined,
    correctAnswer: reveal ? answer : undefined,
  };
}
export type PublicFinal = ReturnType<typeof publicFinal>;
