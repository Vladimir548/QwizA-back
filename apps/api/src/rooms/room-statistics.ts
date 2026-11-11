import {
  captureQuizStatistics,
  createQuizStatistics,
  summarizeQuizResults,
  type QuizStatsMinigame,
  type QuizStatsPlayer,
} from "@qwiza/minigames";
import type { PrivateRoomState, RoomPack } from "./rooms.types";

export function isRoomComplete(pack: RoomPack, state: PrivateRoomState) {
  return (
    state.phase === "board" &&
    (!pack.topics.some((topic) => topic.isFinal) || state.final?.phase === "done") &&
    pack.topics
      .filter((topic) => !topic.isFinal)
      .every((topic) => topic.questions.every((question) => state.played.includes(question.id)))
  );
}

type Player = QuizStatsPlayer & { role: string };
export function roomResultSummary(
  players: (Player & { name: string })[],
  teams: boolean,
  teamCount: number,
  state: PrivateRoomState,
) {
  const participants = players.filter((p) => p.role === "player");
  const entries = teams
    ? Array.from({ length: teamCount }, (_, i) => {
        const id = `team-${i + 1}`;
        return {
          id,
          name: state.teamNames?.[id] ?? `Команда ${i + 1}`,
          score: participants.filter((p) => p.teamId === id).reduce((sum, p) => sum + p.score, 0),
        };
      })
    : participants.map(({ id, name, score }) => ({ id, name, score }));
  return summarizeQuizResults(
    entries,
    state.statistics ?? createQuizStatistics(participants, state.played.length > 0),
    state.victory,
  );
}
export function captureRoomStatistics(
  previous: PrivateRoomState,
  state: PrivateRoomState,
  before: Player[],
  after: Player[],
  type: string,
) {
  const players = after.filter((p) => p.role === "player");
  const oldPlayers = before.filter((p) => p.role === "player");
  let minigame: QuizStatsMinigame | undefined;
  if (previous.phase === "duel" && state.phase === "duel-result" && state.duel) {
    minigame = {
      id: `duel:${state.duel.id}`,
      playerIds: [state.duel.challengerId, state.duel.opponentId],
      winnerIds: state.duel.winnerId ? [state.duel.winnerId] : [],
      duel: true,
    };
  } else if (
    previous.phase === "minigame" &&
    state.phase === "minigame-result" &&
    state.topicEvent
  ) {
    const event = state.topicEvent;
    const winnerIds = (event.standings ?? [])
      .filter((entry) => entry.place === 1)
      .flatMap((entry) =>
        players
          .filter(
            (p) =>
              p.id === entry.id || (p.teamId === entry.id && event.participantIds.includes(p.id)),
          )
          .map((p) => p.id),
      );
    minigame = { id: `topic:${event.topicId}`, playerIds: event.participantIds, winnerIds };
  }
  state.statistics = captureQuizStatistics(
    previous.statistics ?? createQuizStatistics(oldPlayers, previous.played.length > 0),
    oldPlayers,
    players,
    {
      manual: type === "set-score" || type === "set-team-score",
      minigame,
      question:
        previous.final?.phase === "answer" && state.final?.phase === "result"
          ? {
              id: `final:${state.final.selectedId}`,
              answers: Object.entries(state.final.responses).map(([playerId, r]) => ({
                playerId,
                answered: !!r.answer,
                correct: r.correct,
              })),
            }
          : state.phase === "result" && previous.phase !== "result" && state.currentQuestionId
            ? {
                id: state.currentQuestionId,
                answers: state.responses.map((response) => ({
                  playerId: response.participantId,
                  answered: response.answer !== "" || response.verbal === true,
                  correct: response.correct,
                })),
              }
            : undefined,
    },
  );
}
