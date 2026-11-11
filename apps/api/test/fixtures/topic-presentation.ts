import type { RoomPack } from "../../src/rooms/rooms.types";

type Topic = RoomPack["topics"][number];

export interface PresentationRound {
  index: number;
  title: string;
  topics: { id: string; title: string }[];
  startsAt: number;
  endsAt: number;
}

export const TOPIC_REVEAL_DELAY_MS = 900;
export const TOPIC_REVEAL_STEP_MS = 520;
/** Keep aligned with the server presentation protocol. */
export const LOGO_INTRO_MS = 2400;
const ROUND_HOLD_MS = 1500;

export function buildTopicPresentation(
  rounds: string[],
  topics: Pick<Topic, "id" | "title" | "roundIndex" | "isFinal">[],
  startedAt: number,
): PresentationRound[] {
  const count = Math.max(1, rounds.length, ...topics.map((topic) => (topic.roundIndex ?? 0) + 1));
  let cursor = startedAt + LOGO_INTRO_MS;
  return Array.from({ length: count }, (_, index) => {
    const roundTopics = topics
      .filter((topic) => !topic.isFinal && (topic.roundIndex ?? 0) === index)
      .map(({ id, title }) => ({ id, title }));
    const segment: PresentationRound = {
      index,
      title: rounds[index] || `Раунд ${index + 1}`,
      topics: roundTopics,
      startsAt: cursor,
      endsAt:
        cursor + TOPIC_REVEAL_DELAY_MS + roundTopics.length * TOPIC_REVEAL_STEP_MS + ROUND_HOLD_MS,
    };
    cursor = segment.endsAt;
    return segment;
  });
}

/** Derive the visible frame from the authoritative timeline, including late joins. */
export function presentationFrame(rounds: PresentationRound[], now: number) {
  const first = rounds[0];
  if (!first) return null;
  const round = rounds.find((item) => now < item.endsAt) ?? rounds[rounds.length - 1];
  return {
    round,
    isIntro: now < first.startsAt,
    visibleCount: Math.max(
      0,
      Math.min(
        round.topics.length,
        Math.floor((now - round.startsAt - TOPIC_REVEAL_DELAY_MS) / TOPIC_REVEAL_STEP_MS) + 1,
      ),
    ),
    progress: Math.min(
      100,
      Math.max(0, ((now - round.startsAt) / (round.endsAt - round.startsAt)) * 100),
    ),
  };
}
