import {
  advanceFinal,
  createFinal,
  publicFinal,
  hidesFinalScores,
  type FinalCommand,
  type FinalTopic,
} from "@qwiza/minigames";
import { randomInt } from "node:crypto";
import type { PrivateRoomState, RoomPack } from "./rooms.types";

export function finalTopics(pack: RoomPack): FinalTopic[] {
  return pack.topics
    .filter((t) => t.isFinal && t.questions.length === 1)
    .map((t) => ({
      id: t.id,
      title: t.title,
      question: { ...t.questions[0], type: t.questions[0].type as "text" | "choice" },
    }));
}
type Player = { id: string; name: string; score: number; role: string; teamId: string | null };
export function openRoomFinal(
  state: PrivateRoomState,
  pack: RoomPack,
  players: Player[],
  teams: boolean,
  now: number,
) {
  const topics = finalTopics(pack);
  if (
    state.phase !== "board" ||
    state.final ||
    !topics.length ||
    state.duel ||
    state.topicEvent ||
    pack.topics
      .filter((t) => !t.isFinal)
      .some((t) => t.questions.some((q) => !state.played.includes(q.id)))
  )
    return;
  const units = players
    .filter((p) => p.role === "player")
    .filter((p, i, all) => !teams || all.findIndex((other) => other.teamId === p.teamId) === i)
    .map((p) => {
      const members = players.filter(
        (m) => m.role === "player" && (!teams ? m.id === p.id : m.teamId === p.teamId),
      );
      return {
        id: p.id,
        name: teams ? (state.teamNames?.[p.teamId!] ?? p.teamId!) : p.name,
        score: members.reduce((sum, m) => sum + m.score, 0),
        memberIds: members.map((m) => m.id),
      };
    });
  state.final = createFinal(topics, units, now);
  state.phase = "final";
  state.deadlineAt = state.final.deadlineAt;
}
export function progressRoomFinal(
  state: PrivateRoomState,
  pack: RoomPack,
  memberId: string | null,
  command: FinalCommand,
  now: number,
) {
  const before = state.final!;
  const after = advanceFinal(
    before,
    finalTopics(pack),
    memberId,
    command,
    now,
    randomInt(1000000) / 1000000,
  );
  state.final = after;
  state.deadlineAt = after.deadlineAt;
  if (after.phase === "done") {
    state.phase = "board";
    state.deadlineAt = undefined;
  }
  return before.phase === "answer" && after.phase === "result"
    ? Object.entries(after.responses).map(([id, r]) => ({ id, delta: r.delta }))
    : [];
}
export function roomFinalView(state: PrivateRoomState, pack: RoomPack) {
  return state.final
    ? publicFinal(
        state.final,
        finalTopics(pack),
        null,
        hidesFinalScores(state.final, state.victory),
      )
    : undefined;
}
