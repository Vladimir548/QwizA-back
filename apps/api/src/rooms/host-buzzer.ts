import type { PrivateRoomState } from "./rooms.types";

export function eligibleHostBuzzPlayers(
  state: PrivateRoomState,
  players: { id: string; role: string }[],
) {
  return players.filter(
    (player) =>
      player.role === "player" &&
      !state.responses.some(
        (response) => response.participantId === player.id && response.judged,
      ) &&
      !state.skippedPlayers?.includes(player.id) &&
      state.frozenPlayerId !== player.id,
  );
}

export function pauseHostBuzzer(state: PrivateRoomState, now: number) {
  if (!state.hostEnabled || state.buzzRemainingMs !== undefined) return;
  state.buzzRemainingMs = Math.max(0, (state.deadlineAt ?? now) - now);
  state.deadlineAt = undefined;
}

export function resumeHostBuzzer(
  state: PrivateRoomState,
  players: { id: string; role: string }[],
  now: number,
) {
  if (!state.hostEnabled || state.hostRebuzzEnabled === false) return false;
  const remaining = state.buzzRemainingMs ?? Math.max(0, (state.deadlineAt ?? now) - now);
  if (remaining <= 0 || !eligibleHostBuzzPlayers(state, players).length) return false;
  state.phase = "question";
  state.buzzOpensAt = now;
  state.deadlineAt = now + remaining;
  state.buzzRemainingMs = undefined;
  state.buzzWinnerId = undefined;
  state.buzzResolveAt = undefined;
  state.buzzCandidates = [];
  return true;
}
