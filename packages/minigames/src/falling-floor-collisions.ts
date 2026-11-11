export interface FloorVelocity {
  dx: number;
  dy: number;
}
export interface FloorMotionPath {
  player: { id: string };
  x: number;
  y: number;
  endX: number;
  endY: number;
  vx: number;
  vy: number;
  fall: number | null;
}
export const FLOOR_BUMP_DRAG = 7;
const CONTACT_DISTANCE = 0.64;
const MAX_BUMP_SPEED = 4.5;

/** Equal-mass contacts: separate bodies and transfer closing speed into a short bump. */
export function resolveFloorCollisions(
  paths: FloorMotionPath[],
  bumps: Record<string, FloorVelocity>,
  clamp: (value: number) => number,
  canCollide: (a: FloorMotionPath, b: FloorMotionPath) => boolean = () => true,
) {
  const bodies = paths
    .filter((path) => path.fall === null)
    .sort((a, b) => (a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0));
  const impulse = (body: FloorMotionPath, x: number, y: number) => {
    const before = bumps[body.player.id] ?? { dx: 0, dy: 0 };
    const dx = before.dx + x,
      dy = before.dy + y;
    const scale = Math.min(1, MAX_BUMP_SPEED / Math.max(1e-9, Math.hypot(dx, dy)));
    const after = { dx: dx * scale, dy: dy * scale };
    bumps[body.player.id] = after;
    body.vx += after.dx - before.dx;
    body.vy += after.dy - before.dy;
  };
  // Multiple passes also resolve compact groups, with stable pair ordering.
  for (let pass = 0; pass < 4; pass++)
    for (let first = 0; first < bodies.length; first++)
      for (let second = first + 1; second < bodies.length; second++) {
        const a = bodies[first],
          b = bodies[second];
        if (!canCollide(a, b)) continue;
        const dx = b.endX - a.endX,
          dy = b.endY - a.endY,
          distance = Math.hypot(dx, dy);
        if (distance >= CONTACT_DISTANCE) continue;
        const nx = distance > 1e-9 ? dx / distance : 1,
          ny = distance > 1e-9 ? dy / distance : 0;
        const correction = (CONTACT_DISTANCE - distance) / 2;
        a.endX = clamp(a.endX - nx * correction);
        a.endY = clamp(a.endY - ny * correction);
        b.endX = clamp(b.endX + nx * correction);
        b.endY = clamp(b.endY + ny * correction);
        const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (closing >= -0.05) continue;
        const strength = -closing * 0.75;
        impulse(a, -nx * strength, -ny * strength);
        impulse(b, nx * strength, ny * strength);
      }
}

export const resolvePlayerCollisions = resolveFloorCollisions;
export const PLAYER_BUMP_DRAG = FLOOR_BUMP_DRAG;
