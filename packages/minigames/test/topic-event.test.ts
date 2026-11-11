import assert from "node:assert/strict";
import { test } from "node:test";
import {
  awardTopicPrizes,
  castTopicMinigameVote,
  groupMinigames,
  topicMinigameParticipants,
  type TopicMinigameEvent,
} from "../src/topic-event";
const ballot = (count = 5): TopicMinigameEvent => ({
  topicId: "topic",
  title: "Тема",
  roundIndex: 0,
  prize: 2500,
  voterIds: Array.from({ length: count }, (_, i) => `p${i}`),
  participantIds: ["p0", "p1"],
  options: ["shooting", "zone", "moment"],
  votes: {},
});
test("2–2–1 draws only among the two leaders and cannot pick the minority game", () => {
  for (const chosenIndex of [0, 1]) {
    let event = ballot();
    const picks = ["shooting", "zone", "shooting", "zone", "moment"];
    for (let i = 0; i < 4; i++)
      event = castTopicMinigameVote(event, `p${i}`, picks[i], () => {
        throw new Error("Too early");
      });
    assert.equal(event.selected, undefined);
    event = castTopicMinigameVote(event, "p4", picks[4], (upper) => {
      assert.equal(upper, 2);
      return chosenIndex;
    });
    assert.deepEqual(event.leaders, ["shooting", "zone"]);
    assert.equal(event.selected, event.leaders[chosenIndex]);
    assert.throws(() => castTopicMinigameVote(event, "p4", "moment", () => 0));
  }
});
test("a unique plurality wins without randomness; host, duplicate and invalid votes do not count", () => {
  let event = ballot();
  assert.throws(() => castTopicMinigameVote(event, "host", "shooting", () => 0));
  assert.throws(() => castTopicMinigameVote(event, "p0", "hockey", () => 0));
  event = castTopicMinigameVote(event, "p0", "shooting", () => 0);
  assert.throws(() => castTopicMinigameVote(event, "p0", "zone", () => 0));
  for (const [i, kind] of ["shooting", "moment", "zone", "shooting"].entries())
    event = castTopicMinigameVote(event, `p${i + 1}`, kind, () => {
      throw new Error("No tie");
    });
  assert.equal(event.selected, "shooting");
});
test("eligibility excludes duels and over-capacity games; team representatives rotate", () => {
  for (const count of [2, 4, 5, 6, 12])
    assert.deepEqual(groupMinigames(count), [
      "moment",
      "zone",
      "shooting",
      "falling-floor",
      "sequence",
      "rockfall",
      "firefight",
    ]);
  assert.deepEqual(groupMinigames(13), []);
  const players = [
    { id: "a", teamId: "one" },
    { id: "b", teamId: "one" },
    { id: "c", teamId: "two" },
    { id: "d", teamId: "two" },
  ];
  assert.deepEqual(topicMinigameParticipants(players, true, 1), ["b", "d"]);
  assert.deepEqual(topicMinigameParticipants(players, false, 1), ["a", "b", "c", "d"]);
});
test("prizes preserve the fund, split tied places and use 70/30 for two contestants", () => {
  const players = ["a", "b", "c", "d"].map((id, i) => ({ id, name: id, points: 4 - i }));
  assert.deepEqual(
    awardTopicPrizes(players, 2500).map((p) => p.prize),
    [1250, 750, 500, 0],
  );
  assert.deepEqual(
    awardTopicPrizes(players.slice(0, 2), 2500).map((p) => p.prize),
    [1750, 750],
  );
  players[1].points = players[0].points;
  assert.deepEqual(
    awardTopicPrizes(players, 2500).map((p) => p.prize),
    [1000, 1000, 500, 0],
  );
  const tied = players.map((p) => ({ ...p, points: 0 }));
  assert.equal(
    awardTopicPrizes(tied, 103).reduce((sum, p) => sum + p.prize, 0),
    103,
  );
});
