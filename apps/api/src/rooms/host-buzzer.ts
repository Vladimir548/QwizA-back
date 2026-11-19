import { buzzerRetryNoticeMs } from "@qwiza/minigames";
import type { PrivateRoomState } from "./rooms.types";

export function eligibleBuzzPlayers(
  state: PrivateRoomState,
  players: { id: string; role: string }[],
) {
  return players.filter(
    (player) =>
      player.role === "player" &&
      !state.responses.some(
        (response) =>
          response.participantId === player.id && (!state.hostEnabled || response.judged),
      ) &&
      !state.skippedPlayers?.includes(player.id) &&
      state.frozenPlayerId !== player.id,
  );
}

export function pauseBuzzClock(state: PrivateRoomState, now: number) {
  if (
    (!state.hostEnabled && state.hostRebuzzEnabled === false) ||
    state.buzzRemainingMs !== undefined
  )
    return;
  state.buzzRemainingMs = Math.max(0, (state.deadlineAt ?? now) - now);
  state.deadlineAt = undefined;
}

export function resumeBuzzer(
  state: PrivateRoomState,
  players: { id: string; role: string }[],
  now: number,
) {
  if (state.hostRebuzzEnabled === false) return false;
  // The automatic answer window has its own deadline. Only the saved buzzer time can reopen it.
  const remaining =
    state.buzzRemainingMs ?? (state.hostEnabled ? Math.max(0, (state.deadlineAt ?? now) - now) : 0);
  if (remaining <= 0 || !eligibleBuzzPlayers(state, players).length) return false;
  state.phase = "question";
  state.buzzOpensAt = now + buzzerRetryNoticeMs;
  state.deadlineAt = state.buzzOpensAt + remaining;
  state.bonusOpensAt = undefined;
  state.buzzRemainingMs = undefined;
  state.buzzWinnerId = undefined;
  state.buzzResolveAt = undefined;
  state.buzzCandidates = [];
  return true;
}
