import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const apiUrl =
  process.env.QWIZA_ACCEPTANCE_API_URL ??
  process.env.QWESTO_ACCEPTANCE_API_URL ??
  "http://127.0.0.1:4000";
const nickname = `acceptance-${randomUUID().slice(0, 12)}`;
const password = `test-${randomUUID()}-${randomUUID()}`;
let roomId;
let userId;

async function request(path, { method = "GET", body, cookie, token, origin } = {}) {
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

function successful(response, operation) {
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${operation}: HTTP ${response.status} ${JSON.stringify(response.data)}`,
  );
  return response;
}

async function cleanup() {
  loadEnv({ path: fileURLToPath(new URL("../apps/api/.env", import.meta.url)), quiet: true });
  if (!process.env.DATABASE_URL) {
    console.warn(
      `No DATABASE_URL for acceptance cleanup; remove test account ${nickname} manually.`,
    );
    return;
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    if (roomId)
      await db.query('DELETE FROM "GameRoom" WHERE id = $1 AND name LIKE $2', [
        roomId,
        "Auth acceptance %",
      ]);
    if (userId)
      await db.query('DELETE FROM "UserAccount" WHERE id = $1 AND "nicknameKey" = $2', [
        userId,
        nickname,
      ]);
  } finally {
    await db.end();
  }
}

try {
  const room = successful(
    await request("/api/rooms", {
      method: "POST",
      body: {
        name: `Auth acceptance ${randomUUID().slice(0, 8)}`,
        gameMode: "solo",
        maxPlayers: 2,
        displayName: "Проверочный игрок",
        requestedRole: "player",
      },
    }),
    "create room",
  ).data;
  roomId = room.roomId;
  const secondSeat = successful(
    await request(`/api/rooms/${roomId}/join`, {
      method: "POST",
      body: { displayName: "Второе место", requestedRole: "player" },
    }),
    "create second seat",
  ).data;

  const registered = successful(
    await request("/api/auth/register", {
      method: "POST",
      body: { nickname, password },
      origin: "http://localhost:3000",
    }),
    "register",
  );
  userId = registered.data.id;
  assert.equal(registered.data.displayName, nickname);
  assert.ok(
    registered.cookie?.startsWith("qwesto_session="),
    "registration did not set session cookie",
  );

  const me = successful(
    await request("/api/auth/me", { cookie: registered.cookie }),
    "current user",
  ).data;
  assert.equal(me.user.id, userId);
  const anonymousClaim = await request("/api/auth/claim-room", {
    method: "POST",
    body: { roomId, token: room.token },
  });
  assert.equal(anonymousClaim.status, 401, "anonymous request claimed a room seat");

  const claim = successful(
    await request("/api/auth/claim-room", {
      method: "POST",
      body: { roomId, token: room.token },
      cookie: registered.cookie,
      origin: "http://127.0.0.1:3000",
    }),
    "claim room",
  ).data;
  assert.equal(claim.participantId, room.participantId);

  const secondClaim = await request("/api/auth/claim-room", {
    method: "POST",
    body: { roomId, token: secondSeat.token },
    cookie: registered.cookie,
  });
  assert.equal(secondClaim.status, 409, "one account claimed two seats in the same room");

  const rooms = successful(
    await request("/api/auth/rooms", { cookie: registered.cookie }),
    "my rooms",
  ).data;
  assert.ok(
    rooms.some((item) => item.roomId === roomId),
    "claimed room missing from account",
  );

  const rejoined = successful(
    await request("/api/auth/rejoin-room", {
      method: "POST",
      body: { roomId },
      cookie: registered.cookie,
    }),
    "rejoin by account",
  ).data;
  assert.equal(rejoined.participantId, room.participantId);
  assert.notEqual(rejoined.token, room.token, "rejoin did not rotate the participant token");
  assert.equal((await request(`/api/rooms/${roomId}`, { token: room.token })).status, 401);
  successful(
    await request(`/api/rooms/${roomId}`, { token: rejoined.token }),
    "rotated participant token",
  );

  successful(
    await request("/api/auth/logout", { method: "POST", cookie: registered.cookie }),
    "logout",
  );
  assert.equal((await request("/api/auth/me", { cookie: registered.cookie })).data.user, null);
  assert.equal(
    (
      await request("/api/auth/rejoin-room", {
        method: "POST",
        body: { roomId },
        cookie: registered.cookie,
      })
    ).status,
    401,
  );

  const loggedIn = successful(
    await request("/api/auth/login", {
      method: "POST",
      body: { nickname, password },
      origin: "http://127.0.0.1:3000",
    }),
    "login",
  );
  assert.ok(loggedIn.cookie?.startsWith("qwesto_session="));
  assert.equal(loggedIn.data.id, userId);
  assert.equal(
    successful(
      await request("/api/auth/rejoin-room", {
        method: "POST",
        body: { roomId },
        cookie: loggedIn.cookie,
      }),
      "rejoin after login",
    ).data.participantId,
    room.participantId,
  );
  console.log(
    "Auth acceptance passed: register, session, seat claim, uniqueness, rejoin, token rotation, logout and login.",
  );
} finally {
  await cleanup();
}
