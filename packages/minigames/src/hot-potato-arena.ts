export const HOT_POTATO_WIDTH = 20;
export const HOT_POTATO_DEPTH = 12;
export const HOT_POTATO_PLAYER_RADIUS = 0.38;
// The server footprints and the client's fixed camera register to the same market illustration.
export const HOT_POTATO_PLATE = {
  width: 1672,
  height: 941,
  left: 110,
  top: 90,
  scaleX: 72,
  scaleY: 62.8,
} as const;

interface MarketPoint {
  x: number;
  y: number;
}

// Trace the ground contact outlines on the reference plate. The canopy and
// rear stacks extend above their footprints in the fixed perspective view.
function footprint<K extends string>(kind: K, pixels: [number, number][]) {
  const { left: originX, top: originY, scaleX, scaleY } = HOT_POTATO_PLATE;
  const points = pixels.map(([x, y]) => ({ x: (x - originX) / scaleX, y: (y - originY) / scaleY }));
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const left = Math.min(...xs),
    right = Math.max(...xs);
  const back = Math.min(...ys),
    front = Math.max(...ys);
  return {
    kind,
    x: (left + right) / 2,
    y: (back + front) / 2,
    width: right - left,
    depth: front - back,
    points,
  };
}
export const HOT_POTATO_OBSTACLES = [
  footprint("crates", [
    [368, 250],
    [625, 188],
    [754, 240],
    [752, 266],
    [487, 337],
    [368, 295],
  ]),
  footprint("cloth", [
    [1063, 307],
    [1155, 275],
    [1346, 344],
    [1344, 385],
    [1242, 406],
    [1064, 350],
  ]),
  footprint("corn", [
    [805, 390],
    [876, 366],
    [1001, 432],
    [997, 485],
    [901, 511],
    [805, 449],
  ]),
  footprint("apples", [
    [295, 405],
    [371, 375],
    [631, 459],
    [631, 521],
    [565, 552],
    [296, 477],
  ]),
  footprint("cart", [
    [230, 553],
    [249, 532],
    [379, 548],
    [530, 586],
    [530, 646],
    [468, 682],
    [388, 709],
    [317, 666],
    [303, 602],
  ]),
  footprint("barrels", [
    [1113, 542],
    [1221, 517],
    [1320, 542],
    [1344, 582],
    [1334, 620],
    [1280, 656],
    [1168, 645],
    [1114, 610],
  ]),
] as const;

const radius = HOT_POTATO_PLAYER_RADIUS;

function outsideProp(point: MarketPoint, prop: (typeof HOT_POTATO_OBSTACLES)[number]) {
  if (
    Math.abs(point.x - prop.x) > prop.width / 2 + radius ||
    Math.abs(point.y - prop.y) > prop.depth / 2 + radius
  )
    return;
  let inside = false;
  let nearest = Infinity,
    nearestX = 0,
    nearestY = 0,
    normalX = 0,
    normalY = 0;
  for (let i = 0; i < prop.points.length; i++) {
    const a = prop.points[i],
      b = prop.points[(i + 1) % prop.points.length];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    if (a.y > point.y !== b.y > point.y && point.x < a.x + ((point.y - a.y) * dx) / dy)
      inside = !inside;
    const lengthSq = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    const x = a.x + t * dx,
      y = a.y + t * dy;
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance >= nearest) continue;
    nearest = distance;
    nearestX = x;
    nearestY = y;
    normalX = dy / Math.sqrt(lengthSq);
    normalY = -dx / Math.sqrt(lengthSq);
  }
  if (!inside && nearest >= radius * radius) return;
  if (nearest > 1e-12) {
    const sign = (inside ? -1 : 1) / Math.sqrt(nearest);
    normalX = (point.x - nearestX) * sign;
    normalY = (point.y - nearestY) * sign;
  }
  point.x = nearestX + radius * normalX;
  point.y = nearestY + radius * normalY;
}

export function moveHotPotatoPlayer(player: MarketPoint, dx: number, dy: number) {
  player.x += dx;
  player.y += dy;
  const cx = HOT_POTATO_WIDTH / 2,
    cy = HOT_POTATO_DEPTH / 2;
  const edge = Math.hypot((player.x - cx) / (cx - radius), (player.y - cy) / (cy - radius));
  if (edge > 1) {
    player.x = cx + (player.x - cx) / edge;
    player.y = cy + (player.y - cy) / edge;
  }
  for (const prop of HOT_POTATO_OBSTACLES) outsideProp(player, prop);
}
