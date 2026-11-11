import { randomInt } from "node:crypto";
import { earnsDuelChallenge } from "@qwiza/minigames";
import type { PrivateRoomState, RoomResponse } from "./rooms.types";

export function rewardCorrectAnswer(state: PrivateRoomState, response: RoomResponse) {
  if (!state.powersEnabled || !response.correct) return;
  const id = response.participantId;
  state.correctAnswers ??= {};
  const previous = state.correctAnswers[id] ?? 0;
  const count = (state.correctAnswers[id] = previous + 1);
  if (earnsDuelChallenge(previous, count)) {
    state.duelChallenges ??= {};
    state.duelChallenges[id] = true;
  }
  if (count % 3 !== 0) return;
  state.powersByPlayer ??= {};
  const inventory = (state.powersByPlayer[id] ??= { double: 0, shield: 0, freeze: 0 });
  const available = (["double", "shield", "freeze"] as const).filter(
    (power) => inventory[power] === 0,
  );
  if (!available.length) return;
  const awarded = available[randomInt(available.length)];
  inventory[awarded] += 1;
  response.awardedPower = awarded;
}
