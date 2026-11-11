import { MINIGAMES, minigameSupportsMode, type MinigamesForMode } from "./catalog";
import type { MinigameKind } from "./session";

export type GroupMinigameKind = MinigamesForMode<"group">;
export interface TopicMinigameEvent {
  topicId: string;
  title: string;
  roundIndex: number;
  prize: number;
  options: GroupMinigameKind[];
  voterIds: string[];
  participantIds: string[];
  votes: Record<string, GroupMinigameKind>;
  selected?: GroupMinigameKind;
  leaders?: GroupMinigameKind[];
  standings?: { id: string; name: string; points: number; prize: number; place?: number }[];
}

export function topicMinigamePoints(
  players: { id: string; score: number; points?: number; eliminatedAt?: number | null }[],
) {
  return players.map((player) => ({
    id: player.id,
    points:
      player.points ??
      ("eliminatedAt" in player
        ? player.eliminatedAt === null
          ? Number.MAX_SAFE_INTEGER
          : player.eliminatedAt!
        : player.score),
  }));
}

export function groupMinigames(playerCount: number): GroupMinigameKind[] {
  return (Object.keys(MINIGAMES) as MinigameKind[]).filter(
    (kind): kind is GroupMinigameKind =>
      minigameSupportsMode(kind, "group") &&
      playerCount >= 2 &&
      playerCount <= MINIGAMES[kind].maxPlayers,
  );
}

export function castTopicMinigameVote(
  event: TopicMinigameEvent,
  playerId: string,
  game: string,
  randomIndex: (upper: number) => number,
): TopicMinigameEvent {
  if (event.selected) throw new Error("Голосование уже завершено");
  if (!event.voterIds.includes(playerId)) throw new Error("Голосовать могут только игроки стола");
  if (!event.options.includes(game as GroupMinigameKind))
    throw new Error("Эта мини-игра недоступна");
  if (event.votes[playerId]) throw new Error("Твой голос уже принят");
  const next = { ...event, votes: { ...event.votes, [playerId]: game as GroupMinigameKind } };
  if (!event.voterIds.every((id) => next.votes[id])) return next;
  const counts = event.options.map(
    (kind) => event.voterIds.filter((id) => next.votes[id] === kind).length,
  );
  const maximum = Math.max(...counts);
  const leaders = event.options.filter((_, index) => counts[index] === maximum);
  const index = leaders.length === 1 ? 0 : randomIndex(leaders.length);
  if (!Number.isInteger(index) || index < 0 || index >= leaders.length)
    throw new Error("Неверный случайный выбор");
  return { ...next, leaders, selected: leaders[index] };
}

export function topicMinigameParticipants(
  players: { id: string; teamId?: string | null }[],
  teams: boolean,
  topicIndex: number,
): string[] {
  if (!teams) return players.map((player) => player.id);
  return [...new Set(players.map((player) => player.teamId).filter(Boolean))].map((teamId) => {
    const members = players.filter((player) => player.teamId === teamId);
    return members[Math.max(0, topicIndex) % members.length].id;
  });
}

export function awardTopicPrizes(
  entries: { id: string; name: string; points: number }[],
  fund: number,
  kind?: GroupMinigameKind,
) {
  const sorted = [...entries].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  const weights =
    kind === "sequence" && sorted[0]?.points === 10
      ? [100]
      : sorted.length === 2
        ? [70, 30]
        : [50, 30, 20];
  const budgets = weights.map((weight, index) =>
    index === weights.length - 1
      ? fund -
        weights.slice(0, index).reduce((sum, part) => sum + Math.floor((fund * part) / 100), 0)
      : Math.floor((fund * weight) / 100),
  );
  const result: ((typeof sorted)[number] & { prize: number; place: number })[] = [];
  for (let index = 0; index < sorted.length;) {
    const tied = sorted.filter((entry) => entry.points === sorted[index].points);
    const pool = budgets.slice(index, index + tied.length).reduce((sum, value) => sum + value, 0);
    tied.forEach((entry, tieIndex) =>
      result.push({
        ...entry,
        place: index + 1,
        prize: Math.floor(pool / tied.length) + Number(tieIndex < pool % tied.length),
      }),
    );
    index += tied.length;
  }
  return result;
}
