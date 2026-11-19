import { MINIGAMES, minigameSupportsMode, type MinigamesForMode } from "./catalog";
import type { MinigameKind, MinigameSeries } from "./session";
import { shellPlaces } from "./shell-game";

export type GroupMinigameKind = MinigamesForMode<"group">;
export const TEAM_SELECTION_MS = 20_000;

export interface TopicTeamSelection {
  teams: { teamId: string; captainId: string; memberIds: string[] }[];
  choices: Record<string, string>;
  deadlineAt?: number;
}

export interface TopicMinigameEvent {
  topicId: string;
  title: string;
  roundIndex: number;
  prize: number;
  options: GroupMinigameKind[];
  voterIds: string[];
  participantIds: string[];
  votes: Record<string, GroupMinigameKind>;
  teamSelection?: TopicTeamSelection;
  selected?: GroupMinigameKind;
  leaders?: GroupMinigameKind[];
  standings?: { id: string; name: string; points: number; prize: number; place?: number }[];
}

export function topicMinigamePoints(
  players: { id: string; score: number; points?: number; eliminatedAt?: number | null }[],
  series?: MinigameSeries,
) {
  return players.map((player) => ({
    id: player.id,
    points:
      (series && series.roundCount > 1 ? series.wins[player.id] : undefined) ??
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
  if (event.teamSelection) throw new Error("Сначала капитаны выбирают представителей");
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

export function teamCaptain(members: { id: string; seatNumber?: number | null }[]) {
  return members.reduce<(typeof members)[number] | undefined>((first, player) => {
    if (!first || (player.seatNumber ?? Infinity) < (first.seatNumber ?? Infinity)) return player;
    return first;
  }, undefined)?.id;
}

export function topicMinigameRoster(
  players: { id: string; teamId?: string | null; seatNumber?: number | null }[],
  teams: boolean,
  deadlineAt?: number,
): Pick<TopicMinigameEvent, "voterIds" | "participantIds" | "teamSelection"> {
  const voterIds = players.map((player) => player.id);
  if (!teams) return { voterIds, participantIds: voterIds };
  const teamIds = [
    ...new Set(players.flatMap((player) => (player.teamId ? [player.teamId] : []))),
  ].sort();
  const participatingTeams = teamIds.map((teamId) => {
    const members = players.filter((player) => player.teamId === teamId);
    return {
      teamId,
      captainId: teamCaptain(members)!,
      memberIds: members.map((member) => member.id),
    };
  });
  return {
    voterIds,
    participantIds: participatingTeams.map((team) => team.captainId),
    teamSelection: { teams: participatingTeams, choices: {}, deadlineAt },
  };
}

export function finishTopicTeamSelection(event: TopicMinigameEvent): TopicMinigameEvent {
  if (!event.teamSelection) return event;
  const { teams, choices } = event.teamSelection;
  return {
    ...event,
    participantIds: teams.map((team) => choices[team.teamId] ?? team.captainId),
    teamSelection: undefined,
  };
}

export function chooseTopicMinigamePlayer(
  event: TopicMinigameEvent,
  captainId: string,
  playerId: string,
): TopicMinigameEvent {
  const selection = event.teamSelection;
  if (!selection) throw new Error("Выбор участников завершён");
  const team = selection.teams.find((entry) => entry.captainId === captainId);
  if (!team) throw new Error("Участника выбирает капитан команды");
  if (!team.memberIds.includes(playerId)) throw new Error("Выбери игрока из своей команды");
  if (selection.choices[team.teamId]) throw new Error("Представитель команды уже выбран");
  const choices = { ...selection.choices, [team.teamId]: playerId };
  const next = { ...event, teamSelection: { ...selection, choices } };
  return selection.teams.every((entry) => choices[entry.teamId])
    ? finishTopicTeamSelection(next)
    : next;
}

export function awardTopicPrizes(
  entries: { id: string; name: string; points: number }[],
  fund: number,
  kind?: GroupMinigameKind,
) {
  const sorted = [...entries].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  const places = kind === "shell-game" ? shellPlaces(sorted.map(({ points }) => points)) : null;
  const placeCount = places?.size ?? sorted.length;
  const weights =
    places?.size === 1 || (kind === "sequence" && sorted[0]?.points === 10)
      ? [100]
      : placeCount === 2
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
    const place = places?.get(sorted[index].points) ?? index + 1;
    const pool = places
      ? (budgets[place - 1] ?? 0)
      : budgets.slice(index, index + tied.length).reduce((sum, value) => sum + value, 0);
    tied.forEach((entry, tieIndex) =>
      result.push({
        ...entry,
        place,
        prize: Math.floor(pool / tied.length) + Number(tieIndex < pool % tied.length),
      }),
    );
    index += tied.length;
  }
  return result;
}
