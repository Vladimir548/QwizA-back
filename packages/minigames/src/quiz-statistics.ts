export interface QuizPlayerStats {
  answered: number;
  correct: number;
  earned: number;
  lost: number;
  peak: number;
  adjustments: number;
  minigamesPlayed: number;
  minigamesWon: number;
  duelsWon: number;
}
export interface QuizStatistics {
  byId: Record<string, QuizPlayerStats>;
  questions: string[];
  minigames: string[];
  incomplete: boolean;
}
export type PublicQuizStatistics = Pick<QuizStatistics, "byId" | "incomplete">;
export interface QuizStatsPlayer {
  id: string;
  score: number;
  teamId?: string | null;
}
export interface QuizStatsQuestion {
  id: string;
  answers: { playerId: string; answered: boolean; correct: boolean }[];
}
export interface QuizStatsMinigame {
  id: string;
  playerIds: string[];
  winnerIds: string[];
  duel?: boolean;
}

export function emptyQuizPlayerStats(score = 0): QuizPlayerStats {
  return {
    answered: 0,
    correct: 0,
    earned: 0,
    lost: 0,
    peak: score,
    adjustments: 0,
    minigamesPlayed: 0,
    minigamesWon: 0,
    duelsWon: 0,
  };
}
function accounts(players: QuizStatsPlayer[]) {
  const scores: Record<string, number> = {};
  for (const player of players) {
    scores[player.id] = player.score;
    if (player.teamId) scores[player.teamId] = (scores[player.teamId] ?? 0) + player.score;
  }
  return scores;
}
export function createQuizStatistics(
  players: QuizStatsPlayer[] = [],
  incomplete = false,
): QuizStatistics {
  return {
    byId: Object.fromEntries(
      Object.entries(accounts(players)).map(([id, score]) => [id, emptyQuizPlayerStats(score)]),
    ),
    questions: [],
    minigames: [],
    incomplete,
  };
}

/** Observe settled quiz transactions. Replayed results never award statistics twice. */
export function captureQuizStatistics(
  previous: QuizStatistics,
  before: QuizStatsPlayer[],
  after: QuizStatsPlayer[],
  event: { manual?: boolean; question?: QuizStatsQuestion; minigame?: QuizStatsMinigame } = {},
): QuizStatistics {
  const oldScores = accounts(before),
    scores = accounts(after);
  const byId = Object.fromEntries(
    Object.entries(previous.byId).map(([id, stats]) => [id, { ...stats }]),
  );
  for (const [id, score] of Object.entries(scores)) {
    const oldScore = oldScores[id] ?? score;
    const stats = (byId[id] ??= emptyQuizPlayerStats(oldScore));
    const delta = score - oldScore;
    if (event.manual) stats.adjustments += delta;
    else {
      stats.earned += Math.max(0, delta);
      stats.lost += Math.max(0, -delta);
    }
    stats.peak = Math.max(stats.peak, oldScore, score);
  }
  const targets = (id: string) => {
    const player = after.find((p) => p.id === id);
    return player ? [id, ...(player.teamId ? [player.teamId] : [])] : [];
  };
  const question = event.question;
  const newQuestion = question && !previous.questions.includes(question.id);
  if (newQuestion) {
    const results = new Map<string, { answered: boolean; correct: boolean }>();
    for (const answer of question.answers) {
      for (const id of targets(answer.playerId)) {
        const result = results.get(id) ?? { answered: false, correct: false };
        result.answered ||= answer.answered;
        result.correct ||= answer.answered && answer.correct;
        results.set(id, result);
      }
    }
    for (const [id, result] of results) {
      byId[id].answered += Number(result.answered);
      byId[id].correct += Number(result.correct);
    }
  }
  const mini = event.minigame;
  const newMini = mini && !previous.minigames.includes(mini.id);
  if (newMini) {
    const participants = new Set(mini.playerIds.flatMap(targets));
    const winners = new Set(mini.winnerIds.flatMap(targets));
    for (const id of participants) {
      byId[id].minigamesPlayed += 1;
      if (winners.has(id)) {
        byId[id].minigamesWon += 1;
        byId[id].duelsWon += Number(mini.duel ?? false);
      }
    }
  }
  return {
    byId,
    incomplete: previous.incomplete,
    questions: newQuestion ? [...previous.questions, question.id] : previous.questions,
    minigames: newMini ? [...previous.minigames, mini.id] : previous.minigames,
  };
}
