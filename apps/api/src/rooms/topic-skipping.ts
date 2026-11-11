import type { PrivateRoomState, RoomPack } from "./rooms.types";

/** Mutates the locked room state; a creator has no special voting privileges. */
export function skipRoomTopic(
  state: PrivateRoomState,
  pack: RoomPack,
  roundIndex: number,
  topicId: string | undefined,
  participant: { id: string; role: string },
  playerIds: string[],
  hasHost: boolean,
  now: number,
): { error?: string; skipped?: boolean } {
  if (state.phase !== "board") return { error: "Пропустить тему можно только при выборе вопроса" };
  if (state.pickerRouletteEndsAt && now < state.pickerRouletteEndsAt)
    return { error: "Дождись окончания выбора игрока" };
  const topic = pack.topics.find((item) => item.id === topicId);
  if (
    !topic ||
    (topic.roundIndex ?? 0) !== roundIndex ||
    topic.questions.every((question) => state.played.includes(question.id))
  )
    return { error: "Тема недоступна" };
  if (hasHost) {
    if (participant.role !== "host") return { error: "Только ведущий может пропустить тему" };
  } else {
    if (participant.role !== "player" || !playerIds.includes(participant.id))
      return { error: "Голосовать могут только игроки" };
    const votes = state.topicSkipVotes?.[topic.id] ?? [];
    if (votes.includes(participant.id)) return { error: "Ты уже проголосовал" };
    state.topicSkipVotes = { ...state.topicSkipVotes, [topic.id]: [...votes, participant.id] };
    if (!playerIds.every((id) => state.topicSkipVotes![topic.id].includes(id))) return {};
  }
  state.played = [...new Set([...state.played, ...topic.questions.map((question) => question.id)])];
  state.topicSkipVotes = {};
  return { skipped: true };
}
