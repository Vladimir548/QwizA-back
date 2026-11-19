import { groupMinigames, TEAM_SELECTION_MS, topicMinigameRoster } from "@qwiza/minigames";
import type { PrivateRoomState, RoomPack } from "./rooms.types";

export function openTopicMinigameVote(
  state: PrivateRoomState,
  pack: RoomPack,
  players: { id: string; teamId?: string | null; seatNumber?: number | null }[],
  teams: boolean,
  now = Date.now(),
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
  const roster = topicMinigameRoster(players, teams, now + TEAM_SELECTION_MS);
  const options = groupMinigames(roster.participantIds.length);
  if (!options.length) return false;
  state.handledTopicIds = [...(state.handledTopicIds ?? []), topic.id];
  state.topicEvent = {
    topicId: topic.id,
    title: topic.title,
    roundIndex: topic.roundIndex ?? 0,
    prize: topic.questions.reduce((sum, q) => sum + q.value, 0),
    ...roster,
    options,
    votes: {},
  };
  return true;
}
