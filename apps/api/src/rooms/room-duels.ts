import { validateDuel, type DuelPlayer } from "@qwiza/minigames";
import type { PrivateRoomState, RoomCommandInput } from "./rooms.types";

export function applyRoomDuel(
  state: PrivateRoomState,
  input: RoomCommandInput,
  actor: { id: string; role: string },
  players: DuelPlayer[],
  rouletteActive: boolean,
) {
  if (input.type === "offer-duel") {
    if (actor.role !== "player" || !state.powersEnabled || !state.duelChallenges?.[actor.id])
      throw new Error("Нужен бонус «Вызов»: 5 правильных ответов");
    if (state.phase !== "board" || state.duel || rouletteActive)
      throw new Error("Вызвать на дуэль можно между вопросами");
    const kind = input.minigame ?? "";
    validateDuel(players, actor.id, input.targetParticipantId ?? "", kind, input.stake ?? 0);
    state.duel = {
      id: input.id,
      challengerId: actor.id,
      opponentId: input.targetParticipantId!,
      kind,
      stake: input.stake!,
      phase: "pending",
    };
    return;
  }
  const event = state.duel;
  if (!event || input.duelId !== event.id) throw new Error("Эта дуэль уже завершена");
  if (input.type === "finish-duel") {
    if (state.phase !== "duel-result") throw new Error("Дождись результата дуэли");
    if (actor.role !== "host" && ![event.challengerId, event.opponentId].includes(actor.id))
      throw new Error("Продолжить может участник дуэли или ведущий");
    state.duel = undefined;
    state.phase = "board";
    state.deadlineAt = undefined;
    return;
  }
  if (event.phase !== "pending" || state.phase !== "board") throw new Error("Дуэль уже началась");
  if (input.type === "cancel-duel") {
    if (actor.id !== event.challengerId) throw new Error("Отозвать вызов может только отправитель");
    state.duel = undefined;
    return;
  }
  if (actor.id !== event.opponentId || actor.role !== "player")
    throw new Error("Ответить на вызов может только соперник");
  if (input.type === "decline-duel") {
    state.duel = undefined;
    return;
  }
  if (input.type !== "accept-duel") throw new Error("Неизвестная команда дуэли");
  validateDuel(players, event.challengerId, event.opponentId, event.kind, event.stake);
  if (!state.duelChallenges?.[event.challengerId]) throw new Error("Бонус «Вызов» уже использован");
  state.duelChallenges[event.challengerId] = false;
  event.phase = "playing";
  state.phase = "duel";
  state.deadlineAt = Date.now() + 1000;
}
