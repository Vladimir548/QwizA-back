import {
  emptyQuizPlayerStats,
  type PublicQuizStatistics,
  type QuizPlayerStats,
} from "./quiz-statistics";

export const VICTORY_CRITERIA = [
  { id: "score", title: "Итоговый счёт", description: "Больше всего очков к концу игры" },
  { id: "correct", title: "Верные ответы", description: "Больше правильно отвеченных вопросов" },
  {
    id: "earned",
    title: "Заработанные очки",
    description: "Больше игровых начислений без ручных корректировок",
  },
  { id: "fewestLosses", title: "Меньше потерь", description: "Меньше потерянных игровых очков" },
  { id: "peak", title: "Рекорд счёта", description: "Самый высокий счёт за всю игру" },
  {
    id: "minigameWins",
    title: "Победы в мини-играх",
    description: "Больше побед в общих мини-играх и дуэлях",
  },
] as const;
export type VictoryCriterion = (typeof VICTORY_CRITERIA)[number]["id"];
export const VICTORY_CRITERION_IDS = VICTORY_CRITERIA.map((c) => c.id);
export interface VictoryRules {
  mode: "score" | "achievements";
  criteria: VictoryCriterion[];
}
export function defaultVictoryRules(): VictoryRules {
  return { mode: "score", criteria: [...VICTORY_CRITERION_IDS] };
}
export function isVictoryRules(value: unknown): value is VictoryRules {
  if (!value || typeof value !== "object") return false;
  const rules = value as Record<string, unknown>;
  return (
    (rules.mode === "score" || rules.mode === "achievements") &&
    Array.isArray(rules.criteria) &&
    rules.criteria.length > 0 &&
    rules.criteria.length <= VICTORY_CRITERIA.length &&
    new Set(rules.criteria).size === rules.criteria.length &&
    rules.criteria.every((id) => VICTORY_CRITERION_IDS.includes(id))
  );
}
export interface QuizResultEntry {
  id: string;
  name: string;
  score: number;
  isSelf?: boolean;
}
export interface QuizResultStanding extends QuizResultEntry {
  place: number;
  victoryPoints: number;
  awards: VictoryCriterion[];
  stats: QuizPlayerStats;
}
export interface QuizResultSummary {
  rules: VictoryRules;
  standings: QuizResultStanding[];
  awards: { criterion: VictoryCriterion; value: number; winnerIds: string[] }[];
  incomplete: boolean;
  hasMinigames: boolean;
}
export function summarizeQuizResults(
  entries: QuizResultEntry[],
  statistics?: PublicQuizStatistics,
  rules = defaultVictoryRules(),
): QuizResultSummary {
  const standings = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    score: entry.score,
    isSelf: entry.isSelf,
    place: 0,
    victoryPoints: 0,
    awards: [] as VictoryCriterion[],
    stats: statistics?.byId[entry.id] ?? emptyQuizPlayerStats(entry.score),
  }));
  const awards: QuizResultSummary["awards"] = [];
  if (rules.mode === "achievements")
    for (const criterion of rules.criteria) {
      const value = (entry: QuizResultStanding) =>
        criterion === "score"
          ? entry.score
          : criterion === "fewestLosses"
            ? entry.stats.lost
            : criterion === "minigameWins"
              ? entry.stats.minigamesWon
              : entry.stats[criterion];
      const values = standings.map(value);
      const best = criterion === "fewestLosses" ? Math.min(...values) : Math.max(...values);
      const winners = standings.filter((entry) => value(entry) === best);
      const positiveRequired = ["correct", "earned", "minigameWins"].includes(criterion);
      const eligible = winners.length < standings.length && (!positiveRequired || best > 0);
      const winnerIds = eligible ? winners.map((entry) => entry.id) : [];
      for (const winner of eligible ? winners : []) {
        winner.victoryPoints += 1;
        winner.awards.push(criterion);
      }
      awards.push({ criterion, value: Number.isFinite(best) ? best : 0, winnerIds });
    }
  const value = (entry: QuizResultStanding) =>
    rules.mode === "score" ? entry.score : entry.victoryPoints;
  standings.sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id));
  for (const entry of standings)
    entry.place = standings.findIndex((other) => value(other) === value(entry)) + 1;
  return {
    rules,
    standings,
    awards,
    incomplete: statistics?.incomplete ?? false,
    hasMinigames: standings.some((entry) => entry.stats.minigamesPlayed > 0),
  };
}
