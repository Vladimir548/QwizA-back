export const HOCKEY = {
  width: 1000,
  height: 560,
  goal: 190,
  puckRadius: 14,
  malletRadius: 36,
  malletSpeed: 1350,
  puckSpeed: 1050,
  stepMs: 1000 / 120,
  tickMs: 1000 / 30,
  winningGoals: 7,
} as const;

export interface HockeyPoint {
  x: number;
  y: number;
}
export interface HockeyBody extends HockeyPoint {
  vx: number;
  vy: number;
}
export interface HockeyMallet extends HockeyBody {
  target: HockeyPoint;
  sequence: number;
}

export const hockeyClamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export function hockeyTarget(point: HockeyPoint, side: number): HockeyPoint {
  const radius = HOCKEY.malletRadius;
  return {
    x: hockeyClamp(
      point.x,
      side === 0 ? radius : HOCKEY.width / 2 + radius,
      side === 0 ? HOCKEY.width / 2 - radius : HOCKEY.width - radius,
    ),
    y: hockeyClamp(point.y, radius, HOCKEY.height - radius),
  };
}

export function hockeyMallet(side: number): HockeyMallet {
  const point = { x: side === 0 ? 150 : 850, y: HOCKEY.height / 2 };
  return { ...point, vx: 0, vy: 0, target: { ...point }, sequence: -1 };
}

function hitMallet(puck: HockeyBody, mallet: HockeyMallet) {
  const dx = puck.x - mallet.x,
    dy = puck.y - mallet.y;
  const distance = Math.hypot(dx, dy);
  const radius = HOCKEY.puckRadius + HOCKEY.malletRadius;
  if (distance >= radius) return;
  const nx = distance > 0 ? dx / distance : 1,
    ny = distance > 0 ? dy / distance : 0;
  puck.x = mallet.x + nx * (radius + 0.1);
  puck.y = mallet.y + ny * (radius + 0.1);
  const relative = (puck.vx - mallet.vx) * nx + (puck.vy - mallet.vy) * ny;
  if (relative < 0) {
    puck.vx -= 2 * relative * nx;
    puck.vy -= 2 * relative * ny;
  }
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed > HOCKEY.puckSpeed) {
    puck.vx *= HOCKEY.puckSpeed / speed;
    puck.vy *= HOCKEY.puckSpeed / speed;
  }
}

/** One fixed server step. Returns the scorer's side, or null. */
export function stepHockey(puck: HockeyBody, mallets: HockeyMallet[]): number | null {
  const dt = HOCKEY.stepMs / 1000;
  for (const mallet of mallets) {
    const dx = mallet.target.x - mallet.x,
      dy = mallet.target.y - mallet.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > 0 ? Math.min(1, (HOCKEY.malletSpeed * dt) / distance) : 0;
    mallet.vx = (dx * scale) / dt;
    mallet.vy = (dy * scale) / dt;
    mallet.x += mallet.vx * dt;
    mallet.y += mallet.vy * dt;
  }
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;
  for (const mallet of mallets) hitMallet(puck, mallet);
  const r = HOCKEY.puckRadius;
  if (puck.y < r) {
    puck.y = r;
    puck.vy = Math.abs(puck.vy);
  }
  if (puck.y > HOCKEY.height - r) {
    puck.y = HOCKEY.height - r;
    puck.vy = -Math.abs(puck.vy);
  }
  const inGoal = Math.abs(puck.y - HOCKEY.height / 2) < HOCKEY.goal / 2 - r;
  if (!inGoal) {
    if (puck.x < r) {
      puck.x = r;
      puck.vx = Math.abs(puck.vx);
    }
    if (puck.x > HOCKEY.width - r) {
      puck.x = HOCKEY.width - r;
      puck.vx = -Math.abs(puck.vx);
    }
  }
  if (puck.x < -r) return 1;
  if (puck.x > HOCKEY.width + r) return 0;
  return null;
}

/** Each viewer sees their own half at the left (desktop) or bottom (phone). */
export function hockeyView(point: HockeyPoint, side: number, portrait: boolean): HockeyPoint {
  const x = side === 1 ? HOCKEY.width - point.x : point.x;
  const y = side === 1 ? HOCKEY.height - point.y : point.y;
  return portrait ? { x: y, y: HOCKEY.width - x } : { x, y };
}
export function hockeyUnview(point: HockeyPoint, side: number, portrait: boolean): HockeyPoint {
  const x = portrait ? HOCKEY.width - point.y : point.x;
  const y = portrait ? point.x : point.y;
  return side === 1 ? { x: HOCKEY.width - x, y: HOCKEY.height - y } : { x, y };
}
