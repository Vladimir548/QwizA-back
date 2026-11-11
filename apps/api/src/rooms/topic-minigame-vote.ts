import { groupMinigames, topicMinigameParticipants } from "@qwiza/minigames";
import type { PrivateRoomState, RoomPack } from "./rooms.types";

export function openTopicMinigameVote(
  state: PrivateRoomState,
  pack: RoomPack,
  players: { id: string; teamId?: string | null }[],
  teams: boolean,
) {
  if (state.topicMinigamesEnabled === false) return false;
  const topicIndex = pack.topics.findIndex((topic) =>
    topic.questions.some((q) => q.id === state.currentQuestionId),
  );
  const topic = pack.topics[topicIndex];
  if (
    !topic ||
    state.handledTopicIds?.includes(topic.id) ||
    !topic.questions.length ||
    !topic.questions.every((q) => state.answeredQuestions?.includes(q.id))
  )
    return false;
  const participantIds = topicMinigameParticipants(players, teams, topicIndex);
  const options = groupMinigames(participantIds.length);
  if (!options.length) return false;
  state.handledTopicIds = [...(state.handledTopicIds ?? []), topic.id];
  state.topicEvent = {
    topicId: topic.id,
    title: topic.title,
    roundIndex: topic.roundIndex ?? 0,
    prize: topic.questions.reduce((sum, q) => sum + q.value, 0),
    voterIds: players.map((p) => p.id),
    participantIds,
    options,
    votes: {},
  };
  return true;
}
