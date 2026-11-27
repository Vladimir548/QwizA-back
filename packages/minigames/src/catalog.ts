import type { MinigameKind } from "./session";
import { SHOOTING_MAX_PLAYERS } from "./shooting";
import { FALLING_FLOOR_MAX_PLAYERS } from "./falling-floor";
import { MOMENT_MAX_PLAYERS } from "./precise-moment";
import { ZONE_MAX_PLAYERS } from "./zone";
import { SEQUENCE_MAX_PLAYERS } from "./sequence";
import { ROCKFALL_MAX_PLAYERS } from "./rockfall";
import { SHELL_MAX_PLAYERS } from "./shell-game";
import { FIREFIGHT_MAX_PLAYERS } from "./firefight";
import { HOT_POTATO_MAX_PLAYERS } from "./hot-potato";
import { ICE_RACE_MAX_PLAYERS } from "./ice-race";

import { ODD_EVEN_MAX_PLAYERS } from "./odd-even";

export type MinigameMode = "duel" | "group";

export interface MinigameDefinition {
  title: string;
  mode: MinigameMode;
  maxPlayers: number;
  formats?: readonly MinigameMode[];
}

// Participation category, independent of the current demo room capacity.
export const MINIGAMES = {
  memory: { title: "Найди пару", mode: "duel", maxPlayers: 2 },
  hockey: { title: "Аэрохоккей", mode: "duel", maxPlayers: 2 },
  "twenty-one": { title: "21", mode: "duel", maxPlayers: 2 },
  moment: { title: "Точный момент", mode: "group", maxPlayers: MOMENT_MAX_PLAYERS },
  zone: { title: "В зоне", mode: "group", maxPlayers: ZONE_MAX_PLAYERS },
  shooting: { title: "Тир", mode: "group", maxPlayers: SHOOTING_MAX_PLAYERS },
  "number-hunt": {
    title: "Числовая охота",
    mode: "duel",
    maxPlayers: 2,
  },
  "falling-floor": {
    title: "Последняя опора",
    mode: "group",
    maxPlayers: FALLING_FLOOR_MAX_PLAYERS,
  },
  sequence: {
    title: "Повтори последовательность",
    mode: "group",
    maxPlayers: SEQUENCE_MAX_PLAYERS,
  },
  rockfall: { title: "Камнепад", mode: "group", maxPlayers: ROCKFALL_MAX_PLAYERS },
  "double-bluff": { title: "Двойной блеф", mode: "duel", maxPlayers: 2 },
  firefight: {
    title: "Перестрелка",
    mode: "group",
    formats: ["duel", "group"],
    maxPlayers: FIREFIGHT_MAX_PLAYERS,
  },
  "shell-game": {
    title: "Напёрстки",
    mode: "group",
    formats: ["duel", "group"],
    maxPlayers: SHELL_MAX_PLAYERS,
  },
  "ice-race": { title: "Ледяная трасса", mode: "group", maxPlayers: ICE_RACE_MAX_PLAYERS },
  "hot-potato": { title: "Горячая картошка", mode: "group", maxPlayers: HOT_POTATO_MAX_PLAYERS },
  "odd-even": {
    title: "Чёт или нечёт",
    mode: "group",
    formats: ["duel", "group"],
    maxPlayers: ODD_EVEN_MAX_PLAYERS,
  },
} as const satisfies Record<MinigameKind, MinigameDefinition>;

type SupportedModes<K extends MinigameKind> = (typeof MINIGAMES)[K] extends {
  formats: readonly (infer M)[];
}
  ? M
  : (typeof MINIGAMES)[K]["mode"];
export type MinigamesForMode<M extends MinigameMode> = {
  [K in MinigameKind]: M extends SupportedModes<K> ? K : never;
}[MinigameKind];
export function minigameSupportsMode(kind: MinigameKind, mode: MinigameMode) {
  const definition: MinigameDefinition = MINIGAMES[kind];
  return definition.formats?.includes(mode) ?? definition.mode === mode;
}
