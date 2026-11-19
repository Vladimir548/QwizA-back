export const ICE_TRACK_WIDTH = 1040;
export const ICE_TRACK_HEIGHT = 540;
export const ICE_TRACK_RADIUS = 43;
export const ICE_CHECKPOINT_POINTS = 100;

export interface IcePoint {
  x: number;
  y: number;
}

const route: IcePoint[] = [
  { x: 130, y: 390 },
  { x: 130, y: 155 },
  { x: 245, y: 82 },
  { x: 410, y: 82 },
  { x: 514, y: 193 },
  { x: 635, y: 193 },
  { x: 731, y: 83 },
  { x: 859, y: 83 },
  { x: 910, y: 145 },
  { x: 910, y: 322 },
  { x: 802, y: 426 },
  { x: 607, y: 426 },
  { x: 511, y: 323 },
  { x: 358, y: 323 },
  { x: 275, y: 447 },
  { x: 207, y: 447 },
];

export const iceTrackPath = `M ${route.map(({ x, y }) => `${x} ${y}`).join(" L ")} Z`;

const segments = route.map((start, index) => {
  const end = route[(index + 1) % route.length];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return { start, end, length, ux: dx / length, uy: dy / length };
});

export const iceCheckpoints = segments.map(({ start, end, ux, uy }) => ({
  x: (start.x + end.x) / 2,
  y: (start.y + end.y) / 2,
  ux,
  uy,
}));

export function isOnIceTrack({ x, y }: IcePoint) {
  return segments.some(({ start, length, ux, uy }) => {
    const dx = x - start.x;
    const dy = y - start.y;
    const t = Math.max(0, Math.min(length, dx * ux + dy * uy));
    return (dx - t * ux) ** 2 + (dy - t * uy) ** 2 <= ICE_TRACK_RADIUS ** 2;
  });
}

export function crossesIceCheckpoint(from: IcePoint, to: IcePoint, index: number) {
  const gate = iceCheckpoints[index];
  const along = (point: IcePoint) => (point.x - gate.x) * gate.ux + (point.y - gate.y) * gate.uy;
  const before = along(from);
  const after = along(to);
  if (before >= 0 || after < 0) return false;
  const mix = -before / (after - before);
  const x = from.x + (to.x - from.x) * mix - gate.x;
  const y = from.y + (to.y - from.y) * mix - gate.y;
  return Math.abs(y * gate.ux - x * gate.uy) <= ICE_TRACK_RADIUS;
}

export function iceStartPosition(index: number): IcePoint {
  const start = route[0];
  return { x: start.x + ((index % 4) - 1.5) * 17, y: start.y - 24 + Math.floor(index / 4) * 16 };
}
