export const MIN_PLAYERS_PER_TEAM = 2;

export function maxPlayersPerTeam(teamCount: number) {
  return teamCount === 4 ? 2 : 3;
}

export function clampPlayersPerTeam(teamCount: number, playersPerTeam: number) {
  return Math.min(maxPlayersPerTeam(teamCount), Math.max(MIN_PLAYERS_PER_TEAM, playersPerTeam));
}
