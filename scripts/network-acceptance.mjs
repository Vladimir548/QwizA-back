import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { io } from "socket.io-client";
import pg from "pg";

const apiUrl =
  process.env.QWIZA_ACCEPTANCE_API_URL ??
  process.env.QWESTO_ACCEPTANCE_API_URL ??
  "http://127.0.0.1:4000";
const clients = [];
const testRooms = [];

async function cleanup() {
  loadEnv({ path: fileURLToPath(new URL("../apps/api/.env", import.meta.url)), quiet: true });
  if (!process.env.DATABASE_URL) {
    console.warn("No DATABASE_URL for network acceptance cleanup; test rooms remain in local DB.");
    return;
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    for (const room of testRooms) {
      const current = await request(`/api/rooms/${room.id}`, { token: room.token }).catch(
        () => null,
      );
      if (!current || !["lobby", "board"].includes(current.data?.phase)) {
        console.warn(
          `Skipping cleanup of active test room ${room.id}; server timer may still be pending.`,
        );
        continue;
      }
      await db.query('DELETE FROM "GameRoom" WHERE id = $1 AND name = $2', [room.id, room.name]);
    }
  } finally {
    await db.end();
  }
}

async function request(path, { method = "GET", body, token } = {}) {
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

function successful(response, operation) {
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${operation}: HTTP ${response.status} ${JSON.stringify(response.data)}`,
  );
  return response.data;
}

async function connect(roomId, token) {
  const socket = io(new URL("/rooms", apiUrl).toString(), {
    auth: { roomId, token },
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
  });
  const client = { socket, state: null, receivedAt: 0, revisions: [] };
  clients.push(client);
  socket.on("room:latency-probe", (acknowledge) => acknowledge());
  socket.on("room:state", (snapshot) => {
    assert.ok(snapshot && typeof snapshot.revision === "number", "invalid snapshot");
    const previous = client.revisions.at(-1);
    assert.ok(previous === undefined || snapshot.revision >= previous, "revision went backwards");
    client.revisions.push(snapshot.revision);
    client.state = snapshot;
    client.receivedAt = Date.now();
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return client;
}

async function assertSocketRejects(roomId, token) {
  const socket = io(new URL("/rooms", apiUrl).toString(), {
    auth: { roomId, token },
    transports: ["websocket"],
    reconnection: false,
    timeout: 3000,
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect_error", resolve);
      socket.once("connect", () => reject(new Error("socket accepted an invalid token")));
    });
  } finally {
    socket.disconnect();
  }
}

async function waitForState(client, predicate, label, timeoutMs = 15000) {
  if (client.state && predicate(client.state)) return client.state;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.socket.off("room:state", onState);
      reject(new Error(`Timed out waiting for ${label}: ${JSON.stringify(client.state)}`));
    }, timeoutMs);
    function onState(snapshot) {
      if (!predicate(snapshot)) return;
      clearTimeout(timeout);
      client.socket.off("room:state", onState);
      resolve(snapshot);
    }
    client.socket.on("room:state", onState);
  });
}

async function command(client, type, extra = {}, id = randomUUID()) {
  return new Promise((resolve, reject) => {
    client.socket.timeout(5000).emit("room:command", { id, type, ...extra }, (error, ack) => {
      if (error) reject(new Error(`${type}: ${error.message}`));
      else resolve(ack);
    });
  });
}

async function pickAsSelectedPlayer(observer, playerClients, questionId, label) {
  const board = await waitForState(observer, (state) => state.phase === "board", label);
  const picker = playerClients.get(board.pickerId);
  assert.ok(picker, `${label}: picker is not a seated player`);
  if (board.pickerRouletteEndsAt) {
    await waitForState(
      observer,
      (state) => state.phase === "board" && !state.pickerRouletteEndsAt,
      `${label}: roulette finished`,
      8000,
    );
  }
  assert.equal((await command(picker, "pick", { questionId })).ok, true);
}

function assertNoAnswerLeak(snapshot) {
  const serialized = JSON.stringify(snapshot);
  for (const key of [
    "answerText",
    "correctChoiceIndex",
    "acceptedAnswers",
    "geoTarget",
    "imageTarget",
  ]) {
    assert.ok(!serialized.includes(`"${key}"`), `private answer field ${key} leaked`);
  }
}

function participantCount(snapshot, id) {
  return snapshot.participants.filter((participant) => participant.id === id).length;
}

try {
  const roomName = `Acceptance ${randomUUID().slice(0, 8)}`;
  const created = successful(
    await request("/api/rooms", {
      method: "POST",
      body: {
        name: roomName,
        gameMode: "solo",
        maxPlayers: 2,
        displayName: "Первый игрок",
        requestedRole: "player",
      },
    }),
    "create room",
  );
  testRooms.push({ id: created.roomId, name: roomName, token: created.token });
  assert.equal(created.snapshot.hostEnabled, false);
  assert.deepEqual(created.snapshot.topics, [], "lobby exposed topics before the game started");
  assert.ok(created.snapshot.packQuestionCount > 0);
  const noHostPreview = successful(
    await request(`/api/rooms/${created.roomId}/preview`),
    "preview room without host",
  );
  assert.equal(noHostPreview.hostEnabled, false);
  assert.equal(noHostPreview.hostAvailable, false);
  const joined = successful(
    await request(`/api/rooms/${created.roomId}/join`, {
      method: "POST",
      body: { displayName: "Второй игрок", requestedRole: "host" },
    }),
    "join room",
  );
  assert.notEqual(created.participantId, joined.participantId);
  assert.equal(joined.roomId, created.roomId);
  assert.equal(participantCount(joined.snapshot, created.participantId), 1);
  assert.equal(participantCount(joined.snapshot, joined.participantId), 1);
  assert.equal(
    joined.snapshot.participants.find((person) => person.id === joined.participantId)?.role,
    "player",
    "room without host assigned a host seat",
  );

  const excess = await request(`/api/rooms/${created.roomId}/join`, {
    method: "POST",
    body: { displayName: "Лишний игрок", requestedRole: "player" },
  });
  assert.ok(excess.status >= 400, "room accepted a player beyond maxPlayers");
  const openHostName = `Open host ${randomUUID().slice(0, 8)}`;
  const openHost = successful(
    await request("/api/rooms", {
      method: "POST",
      body: {
        name: openHostName,
        gameMode: "solo",
        maxPlayers: 2,
        displayName: "Создатель",
        hostEnabled: true,
        requestedRole: "player",
      },
    }),
    "create room with a vacant host seat",
  );
  testRooms.push({ id: openHost.roomId, name: openHostName, token: openHost.token });
  assert.equal(openHost.snapshot.hostEnabled, true);
  assert.equal(
    successful(await request(`/api/rooms/${openHost.roomId}/preview`), "preview vacant host")
      .hostAvailable,
    true,
  );
  const claimedHost = successful(
    await request(`/api/rooms/${openHost.roomId}/join`, {
      method: "POST",
      body: { displayName: "Новый ведущий", requestedRole: "host" },
    }),
    "claim vacant host seat",
  );
  assert.equal(
    claimedHost.snapshot.participants.find((person) => person.id === claimedHost.participantId)
      ?.role,
    "host",
  );
  assert.equal(
    successful(await request(`/api/rooms/${openHost.roomId}/preview`), "preview occupied host")
      .hostAvailable,
    false,
  );
  const openHostCreator = await connect(openHost.roomId, openHost.token);
  const openHostGuest = await connect(openHost.roomId, claimedHost.token);
  assert.equal((await command(openHostGuest, "change-seat", { role: "player" })).ok, true);
  assert.equal(
    successful(await request(`/api/rooms/${openHost.roomId}/preview`), "preview released host")
      .hostAvailable,
    true,
  );
  assert.equal((await command(openHostCreator, "change-seat", { role: "host" })).ok, true);
  assert.equal((await command(openHostGuest, "change-seat", { role: "host" })).ok, false);
  assert.equal((await command(openHostCreator, "change-seat", { role: "player" })).ok, true);
  assert.equal((await command(openHostGuest, "change-seat", { role: "host" })).ok, true);
  const hostedRoomName = `Host acceptance ${randomUUID().slice(0, 8)}`;
  const hosted = successful(
    await request("/api/rooms", {
      method: "POST",
      body: {
        name: hostedRoomName,
        gameMode: "solo",
        maxPlayers: 2,
        displayName: "Ведущий",
        requestedRole: "host",
      },
    }),
    "create hosted room",
  );
  testRooms.push({ id: hosted.roomId, name: hostedRoomName, token: hosted.token });
  const secondHost = successful(
    await request(`/api/rooms/${hosted.roomId}/join`, {
      method: "POST",
      body: { displayName: "Претендент", requestedRole: "host" },
    }),
    "join occupied host seat",
  );
  assert.equal(
    secondHost.snapshot.participants.find((person) => person.id === hosted.participantId)?.role,
    "host",
  );
  assert.equal(
    secondHost.snapshot.participants.find((person) => person.id === secondHost.participantId)?.role,
    "player",
    "second host was not assigned a player seat",
  );
  const teamRoomName = `Teams acceptance ${randomUUID().slice(0, 8)}`;
  const teamRoom = successful(
    await request("/api/rooms", {
      method: "POST",
      body: {
        name: teamRoomName,
        gameMode: "team",
        teamCount: 4,
        maxPlayers: 8,
        displayName: "Игрок 1",
        requestedRole: "player",
      },
    }),
    "create four-team room",
  );
  testRooms.push({ id: teamRoom.roomId, name: teamRoomName, token: teamRoom.token });
  assert.equal(teamRoom.snapshot.teamCount, 4);
  const selectedTeamPlayer = successful(
    await request(`/api/rooms/${teamRoom.roomId}/join`, {
      method: "POST",
      body: { displayName: "Игрок 2", requestedRole: "player", teamNumber: 4 },
    }),
    "join selected team",
  );
  assert.equal(
    selectedTeamPlayer.snapshot.participants.find(
      (person) => person.id === selectedTeamPlayer.participantId,
    )?.teamId,
    "team-4",
  );
  const movingPlayer = await connect(teamRoom.roomId, selectedTeamPlayer.token);
  assert.equal(
    (await command(movingPlayer, "rename-team", { teamNumber: 4, teamName: "Знатоки" })).ok,
    true,
  );
  assert.equal(
    (
      await waitForState(
        movingPlayer,
        (state) => state.teamNames?.["team-4"] === "Знатоки",
        "renamed team",
      )
    ).teamNames["team-4"],
    "Знатоки",
  );
  assert.equal(
    successful(await request(`/api/rooms/${teamRoom.roomId}/preview`), "renamed team preview")
      .teamNames["team-4"],
    "Знатоки",
  );
  assert.equal(
    (await command(movingPlayer, "rename-team", { teamNumber: 5, teamName: "Несуществующая" })).ok,
    false,
  );
  assert.equal(
    (await command(movingPlayer, "rename-team", { teamNumber: 4, teamName: " ".repeat(4) })).ok,
    false,
  );
  assert.equal(
    (await command(movingPlayer, "change-seat", { role: "player", teamNumber: 2 })).ok,
    true,
  );
  assert.equal(
    (await command(movingPlayer, "change-seat", { role: "player", teamNumber: 4 })).ok,
    true,
  );
  assert.equal((await command(movingPlayer, "change-seat", { role: "host" })).ok, false);
  let teamSnapshot = successful(
    await request(`/api/rooms/${teamRoom.roomId}/join`, {
      method: "POST",
      body: { displayName: "Игрок 3", requestedRole: "player", teamNumber: 4 },
    }),
    "fill selected team",
  ).snapshot;
  const fullTeam = await request(`/api/rooms/${teamRoom.roomId}/join`, {
    method: "POST",
    body: { displayName: "Лишний в команде", requestedRole: "player", teamNumber: 4 },
  });
  assert.equal(fullTeam.status, 409);
  assert.equal(
    successful(await request(`/api/rooms/${teamRoom.roomId}/preview`), "preview team counts")
      .teamPlayerCounts[3],
    2,
  );
  for (let index = 4; index <= 8; index++) {
    teamSnapshot = successful(
      await request(`/api/rooms/${teamRoom.roomId}/join`, {
        method: "POST",
        body: { displayName: `Игрок ${index}`, requestedRole: "player" },
      }),
      `join four-team room: player ${index}`,
    ).snapshot;
  }
  for (let index = 1; index <= 4; index++) {
    assert.equal(
      teamSnapshot.participants.filter((person) => person.teamId === `team-${index}`).length,
      2,
      `team ${index} was not filled evenly`,
    );
  }
  const teamExcess = await request(`/api/rooms/${teamRoom.roomId}/join`, {
    method: "POST",
    body: { displayName: "Девятый игрок", requestedRole: "player" },
  });
  assert.equal(teamExcess.status, 409);
  assert.equal(
    (await command(movingPlayer, "change-seat", { role: "player", teamNumber: 1 })).ok,
    false,
  );
  const hostedSecondPlayer = successful(
    await request(`/api/rooms/${hosted.roomId}/join`, {
      method: "POST",
      body: { displayName: "Ещё игрок", requestedRole: "player" },
    }),
    "fill hosted room",
  );
  const hostClient = await connect(hosted.roomId, hosted.token);
  const hostPlayerA = await connect(hosted.roomId, secondHost.token);
  const hostPlayerB = await connect(hosted.roomId, hostedSecondPlayer.token);
  assert.equal(
    (
      await command(hostPlayerA, "set-score", {
        targetParticipantId: secondHost.participantId,
        score: 50,
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await command(hostClient, "set-score", {
        targetParticipantId: secondHost.participantId,
        score: 275,
      })
    ).ok,
    true,
  );
  const scored = await waitForState(
    hostPlayerA,
    (state) =>
      state.participants.some(
        (person) => person.id === secondHost.participantId && person.score === 275,
      ),
    "host score edit",
  );
  assert.equal(
    scored.participants.find((person) => person.id === secondHost.participantId).score,
    275,
  );
  assert.equal((await command(hostClient, "start")).ok, true);
  const hostedIntro = await waitForState(
    hostClient,
    (state) => state.phase === "presentation",
    "hosted topic presentation",
  );
  assert.ok(hostedIntro.presentationRounds?.[0]?.topics.length);
  const hostedBoard = await waitForState(
    hostClient,
    (state) => state.phase === "board",
    "hosted board",
  );
  assert.ok(
    [secondHost.participantId, hostedSecondPlayer.participantId].includes(hostedBoard.pickerId),
    "hosted roulette selected a non-player",
  );
  await pickAsSelectedPlayer(
    hostClient,
    new Map([
      [secondHost.participantId, hostPlayerA],
      [hostedSecondPlayer.participantId, hostPlayerB],
    ]),
    hostedBoard.topics[0].questions[0].id,
    "hosted board",
  );
  const hostedQuestion = await waitForState(
    hostClient,
    (state) => state.phase === "question",
    "hosted question",
  );
  const hostAnswer = successful(
    await request(`/api/rooms/${hosted.roomId}/host-answer`, { token: hosted.token }),
    "host answer",
  );
  assert.equal(hostAnswer.questionId, hostedQuestion.currentQuestion.id);
  assert.ok(hostAnswer.answer);
  assert.equal(
    (await request(`/api/rooms/${hosted.roomId}/host-answer`, { token: secondHost.token })).status,
    403,
  );
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, hostedQuestion.currentQuestion.buzzOpensAt - Date.now() + 50)),
  );
  assert.equal((await command(hostPlayerA, "skip")).ok, true);
  assert.equal((await command(hostPlayerB, "skip")).ok, true);
  const skipped = await waitForState(
    hostClient,
    (state) => state.phase === "result",
    "all players skipped",
  );
  assert.equal(skipped.result.skipped, true);
  const unauthorized = await request(`/api/rooms/${created.roomId}`);
  assert.ok(
    unauthorized.status === 401 || unauthorized.status === 403,
    "room snapshot lacks authorization",
  );
  await assertSocketRejects(created.roomId, "invalid-token");

  const a = await connect(created.roomId, created.token);
  let b = await connect(joined.roomId, joined.token);
  await waitForState(
    a,
    (state) => participantCount(state, joined.participantId) === 1,
    "joined roster",
  );
  assertNoAnswerLeak(a.state);
  assert.equal((await command(a, "change-seat", { role: "host" })).ok, false);

  b.socket.disconnect();
  const rejoined = successful(
    await request(`/api/rooms/${created.roomId}`, { token: joined.token }),
    "rejoin snapshot",
  );
  assert.equal(participantCount(rejoined, joined.participantId), 1);
  b = await connect(joined.roomId, joined.token);
  await waitForState(
    b,
    (state) => participantCount(state, joined.participantId) === 1,
    "reconnected roster",
  );

  assert.equal((await command(b, "start")).ok, false, "non-creator started the room");

  const startId = randomUUID();
  assert.equal((await command(a, "start", {}, startId)).ok, true);
  const introduction = await waitForState(
    a,
    (state) => state.phase === "presentation",
    "topic presentation",
  );
  assert.ok(introduction.presentationRounds?.[0]?.topics.length);
  const board = await waitForState(a, (state) => state.phase === "board", "board phase");
  const secondBoard = await waitForState(b, (state) => state.phase === "board", "second board");
  assert.equal(secondBoard.pickerId, board.pickerId, "clients disagree on roulette winner");
  assert.ok(
    [created.participantId, joined.participantId].includes(board.pickerId),
    "roulette selected a non-player",
  );
  assert.equal((await command(b, "change-seat", { role: "player" })).ok, false);
  const startRevision = board.revision;
  await command(a, "start", {}, startId);
  assert.equal(a.state.revision, startRevision, "duplicate start changed the state");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    successful(
      await request(`/api/rooms/${created.roomId}`, { token: created.token }),
      "idle board",
    ).revision,
    startRevision,
    "board revision advanced without a command",
  );

  const questionId = board.topics.flatMap((topic) => topic.questions)[0]?.id;
  assert.ok(questionId, "starter pack has no question");
  const pickerClient = board.pickerId === created.participantId ? a : b;
  const otherClient = pickerClient === a ? b : a;
  assert.equal(
    (await command(otherClient, "pick", { questionId })).ok,
    false,
    "non-picker selected a question",
  );
  if (board.pickerRouletteEndsAt) {
    assert.equal(
      (await command(pickerClient, "pick", { questionId })).ok,
      false,
      "picker selected a question before roulette ended",
    );
  }
  await pickAsSelectedPlayer(
    a,
    new Map([
      [created.participantId, a],
      [joined.participantId, b],
    ]),
    questionId,
    "solo board",
  );
  const question = await waitForState(a, (state) => state.phase === "question", "question phase");
  await waitForState(b, (state) => state.phase === "question", "question on second client");
  assert.equal(a.state.currentQuestion.id, b.state.currentQuestion.id);
  assert.deepEqual(question.currentQuestion.options, [], "choices appeared before the buzzer");
  assertNoAnswerLeak(a.state);
  assertNoAnswerLeak(b.state);
  assertNoAnswerLeak(
    successful(
      await request(`/api/rooms/${created.roomId}`, { token: joined.token }),
      "live snapshot",
    ),
  );
  assert.equal(
    (await command(b, "answer", { questionId, answer: "premature" })).ok,
    false,
    "server accepted answer before buzz winner",
  );

  const opensAt = question.currentQuestion.buzzOpensAt;
  const serverNow = question.serverTime + (Date.now() - a.receivedAt);
  if (opensAt - serverNow > 400) {
    const early = await command(a, "buzz", { questionId });
    assert.equal(early.ok, false, "server accepted buzz before button opening");
  }
  const delay = Math.max(0, opensAt - (question.serverTime + Date.now() - a.receivedAt) + 25);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const buzzId = randomUUID();
  const [aBuzz, bBuzz] = await Promise.all([
    command(a, "buzz", { questionId }, buzzId),
    command(b, "buzz", { questionId }),
  ]);
  assert.ok(aBuzz && bBuzz, "missing buzz acknowledgements");
  const winnerA = await waitForState(a, (state) => !!state.buzzWinnerId, "buzz winner", 5000);
  const winnerB = await waitForState(b, (state) => !!state.buzzWinnerId, "same buzz winner", 5000);
  assert.equal(winnerA.buzzWinnerId, winnerB.buzzWinnerId);
  assert.ok(winnerA.currentQuestion.options.length > 0, "choices stayed hidden after the buzzer");
  assert.ok([created.participantId, joined.participantId].includes(winnerA.buzzWinnerId));
  const loser = winnerA.buzzWinnerId === created.participantId ? b : a;
  assert.equal(
    (
      await command(loser, "answer", {
        questionId,
        answer: "Вуди",
        participantId: winnerA.buzzWinnerId,
      })
    ).ok,
    false,
    "loser answered by forging winner participantId",
  );
  const winnerRevision = a.state.revision;
  await command(a, "buzz", { questionId }, buzzId);
  assert.equal(a.state.revision, winnerRevision, "duplicate buzz changed the state");

  a.socket.disconnect();
  b.socket.disconnect();
  const remaining = winnerA.currentQuestion.deadlineAt - winnerA.serverTime + 1000;
  await new Promise((resolve) => setTimeout(resolve, Math.max(1000, remaining)));
  const afterDeadline = successful(
    await request(`/api/rooms/${created.roomId}`, { token: created.token }),
    "snapshot after deadline without connected clients",
  );
  assert.ok(
    afterDeadline.phase !== "question",
    `question timer stopped without connected clients: serverTime=${afterDeadline.serverTime}, deadlineAt=${afterDeadline.currentQuestion?.deadlineAt}, revision=${afterDeadline.revision}`,
  );
  assert.ok(afterDeadline.revision > question.revision, "deadline did not advance revision");

  const boardDeadline = Date.now() + 8000;
  let settled = afterDeadline;
  while (settled.phase !== "board" && Date.now() < boardDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    settled = successful(
      await request(`/api/rooms/${created.roomId}`, { token: created.token }),
      "settled board",
    );
  }
  assert.equal(settled.phase, "board", "result did not return to board on server timer");

  const bonusRoomName = `Bonus acceptance ${randomUUID().slice(0, 8)}`;
  const bonusRoom = successful(
    await request("/api/rooms", {
      method: "POST",
      body: {
        name: bonusRoomName,
        gameMode: "solo",
        maxPlayers: 2,
        displayName: "Ведущий бонусов",
        requestedRole: "host",
        powersEnabled: true,
      },
    }),
    "create bonus room",
  );
  testRooms.push({ id: bonusRoom.roomId, name: bonusRoomName, token: bonusRoom.token });
  const bonusPlayer = successful(
    await request(`/api/rooms/${bonusRoom.roomId}/join`, {
      method: "POST",
      body: { displayName: "Игрок с бонусом", requestedRole: "player" },
    }),
    "join bonus player",
  );
  const bonusOpponent = successful(
    await request(`/api/rooms/${bonusRoom.roomId}/join`, {
      method: "POST",
      body: { displayName: "Соперник", requestedRole: "player" },
    }),
    "join bonus opponent",
  );
  const bonusHostClient = await connect(bonusRoom.roomId, bonusRoom.token);
  const bonusPlayerClient = await connect(bonusRoom.roomId, bonusPlayer.token);
  const bonusOpponentClient = await connect(bonusRoom.roomId, bonusOpponent.token);
  const bonusPlayerClients = new Map([
    [bonusPlayer.participantId, bonusPlayerClient],
    [bonusOpponent.participantId, bonusOpponentClient],
  ]);
  assert.equal((await command(bonusHostClient, "start")).ok, true);
  await waitForState(bonusHostClient, (state) => state.phase === "board", "bonus board");
  async function waitUntilServerTime(client, timestamp) {
    const delay = Math.max(
      0,
      timestamp - (client.state.serverTime + Date.now() - client.receivedAt) + 50,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  for (const [questionId, answer] of [
    ["mix-0-0", 0],
    ["mix-1-0", 1],
    ["mix-2-0", 2],
  ]) {
    await pickAsSelectedPlayer(bonusHostClient, bonusPlayerClients, questionId, "bonus board");
    const current = await waitForState(
      bonusPlayerClient,
      (state) => state.phase === "question" && state.currentQuestion?.id === questionId,
      `bonus question ${questionId}`,
    );
    assert.equal(
      current.currentQuestion.bonusOpensAt,
      undefined,
      "bonus window opened before player earned any bonus",
    );
    await waitUntilServerTime(bonusPlayerClient, current.currentQuestion.buzzOpensAt);
    assert.equal((await command(bonusPlayerClient, "buzz")).ok, true);
    await waitForState(
      bonusPlayerClient,
      (state) => state.buzzWinnerId === bonusPlayer.participantId,
      "bonus player buzz winner",
    );
    assert.equal((await command(bonusPlayerClient, "answer", { answer })).ok, true);
    const outcome = await waitForState(
      bonusPlayerClient,
      (state) => state.phase === "result",
      `bonus result ${questionId}`,
    );
    assert.equal(outcome.result.responses[0].correct, true);
    assert.equal((await command(bonusHostClient, "next")).ok, true);
    await waitForState(bonusHostClient, (state) => state.phase === "board", "next bonus board");
  }
  const awarded = bonusPlayerClient.state.powersByPlayer[bonusPlayer.participantId];
  const earnedPower = ["double", "shield", "freeze"].find((power) => awarded[power] === 1);
  assert.ok(earnedPower, "three correct answers did not award a bonus");
  assert.equal(bonusPlayerClient.state.correctAnswers[bonusPlayer.participantId], 3);
  await pickAsSelectedPlayer(bonusHostClient, bonusPlayerClients, "mix-1-3", "earned bonus board");
  const bonusQuestion = await waitForState(
    bonusPlayerClient,
    (state) => state.phase === "question" && state.currentQuestion?.id === "mix-1-3",
    "earned bonus window",
  );
  assert.ok(bonusQuestion.currentQuestion.bonusOpensAt);
  assert.equal(
    (await command(bonusPlayerClient, "buzz")).ok,
    false,
    "buzz was allowed before bonus window ended",
  );
  await waitUntilServerTime(bonusPlayerClient, bonusQuestion.currentQuestion.bonusOpensAt);
  assert.equal(
    (
      await command(bonusPlayerClient, "use-power", {
        power: earnedPower,
        ...(earnedPower === "freeze" ? { targetParticipantId: bonusOpponent.participantId } : {}),
      })
    ).ok,
    true,
  );
  await waitForState(
    bonusOpponentClient,
    (state) => state.powersByPlayer[bonusPlayer.participantId][earnedPower] === 0,
    "broadcast bonus use",
  );
  assert.equal((await command(bonusPlayerClient, "skip-bonuses")).ok, true);
  assert.equal((await command(bonusOpponentClient, "skip-bonuses")).ok, true);
  const earlyOpen = await waitForState(
    bonusPlayerClient,
    (state) => state.phase === "question" && !state.currentQuestion.bonusOpensAt,
    "everyone skipped bonuses",
  );
  assert.ok(
    earlyOpen.currentQuestion.buzzOpensAt < bonusQuestion.currentQuestion.buzzOpensAt,
    "skip did not advance the answer opening",
  );
  if (earnedPower === "freeze")
    assert.equal(
      (await command(bonusOpponentClient, "buzz")).ok,
      false,
      "frozen opponent could buzz",
    );
  assert.equal((await command(bonusPlayerClient, "buzz")).ok, true);
  await waitForState(
    bonusPlayerClient,
    (state) => state.buzzWinnerId === bonusPlayer.participantId,
    "bonus answer buzz winner",
  );
  assert.equal(
    (
      await command(bonusPlayerClient, "answer", {
        answer: earnedPower === "double" ? 1 : "неверно",
      })
    ).ok,
    true,
  );
  const bonusOutcome = await waitForState(
    bonusPlayerClient,
    (state) => state.phase === "result",
    "bonus outcome",
  );
  if (earnedPower === "shield") assert.equal(bonusOutcome.result.responses[0].scoreDelta, 0);
  else if (earnedPower === "double")
    assert.equal(
      bonusOutcome.result.responses[0].scoreDelta,
      1600,
      "risk reward and double were not applied",
    );
  else
    assert.equal(bonusOutcome.result.responses[0].scoreDelta, -800, "risk penalty was not doubled");
  assert.equal((await command(bonusHostClient, "next")).ok, true);
  await waitForState(bonusHostClient, (state) => state.phase === "board", "bonus cleanup board");

  console.log(
    "Network acceptance passed: four teams, capacity, rejoin, secrecy, buzzer arbitration, server deadline and earned bonuses.",
  );
} finally {
  for (const client of clients) client.socket.disconnect();
  await cleanup();
}
