import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { WebSocket } from "ws";

type RoomPayload = { code: string; status: string; version: number; state: { setupState?: { phase: string; seats: Array<{ monsterId?: string }> } }; events: Array<{ version: number }>; participants: Array<{ id: string; displayName: string; role: "player" | "spectator"; connected: boolean; ready: boolean }> };

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The child process may still be binding its port.
    }
    await wait(25);
  }
  throw new Error("API server did not become healthy in time.");
}

async function waitForMetrics(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/metrics`);
      if (response.ok) return;
    } catch {
      // The child process may still be binding its port.
    }
    await wait(25);
  }
  throw new Error("API metrics endpoint did not become available in time.");
}

async function createWebSocketTicket(baseUrl: string, code: string, token: string, connectionId: string | null = null, requestedConnectionId?: string): Promise<{ ticket: string; connectionId: string }> {
  const response = await fetch(`${baseUrl}/rooms/${code}/ws-ticket`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-room-token": token },
    body: JSON.stringify({ connectionId, ...(requestedConnectionId ? { requestedConnectionId } : {}) }),
  });
  const result = await response.json() as { ticket?: string; connectionId?: string; error?: string };
  assert.equal(response.ok, true, result.error ?? `WebSocket ticket failed with HTTP ${response.status}`);
  assert.ok(result.ticket && result.connectionId);
  return { ticket: result.ticket, connectionId: result.connectionId };
}

function nextWebSocketMessage(socket: WebSocket, timeoutMs = 5_000): Promise<RoomPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for a WebSocket room update after ${timeoutMs}ms.`)); }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: string; room?: RoomPayload };
        if (message.type !== "room.updated" || !message.room) throw new Error(`Expected a WebSocket room update, received ${message.type ?? "an unknown message"}.`);
        cleanup();
        resolve(message.room);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = (code: number, reason: Buffer) => { cleanup(); reject(new Error(`WebSocket closed before the expected room update (${code}: ${reason.toString()}).`)); };
    const cleanup = () => { clearTimeout(timeout); socket.off("message", onMessage); socket.off("error", onError); socket.off("close", onClose); };
    socket.once("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function nextWebSocketMessageMatching(socket: WebSocket, predicate: (room: RoomPayload) => boolean, timeoutMs = 5_000): Promise<RoomPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for a matching WebSocket room update after ${timeoutMs}ms.`)); }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: string; room?: RoomPayload };
        if (message.type !== "room.updated" || !message.room) throw new Error(`Expected a WebSocket room update, received ${message.type ?? "an unknown message"}.`);
        if (!predicate(message.room)) return;
        cleanup();
        resolve(message.room);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = (code: number, reason: Buffer) => { cleanup(); reject(new Error(`WebSocket closed before a matching room update (${code}: ${reason.toString()}).`)); };
    const cleanup = () => { clearTimeout(timeout); socket.off("message", onMessage); socket.off("error", onError); socket.off("close", onClose); };
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function nextWebSocketCommandResult(socket: WebSocket, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for a WebSocket command result after ${timeoutMs}ms.`)); }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(data.toString()) as Record<string, unknown>; }
      catch { cleanup(); reject(new Error("Received invalid JSON from WebSocket.")); return; }
      if (message.type === "command.accepted" || message.type === "command.rejected" || message.type === "protocol.error") {
        cleanup();
        resolve(message);
      }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = (code: number, reason: Buffer) => { cleanup(); reject(new Error(`WebSocket closed before the command result (${code}: ${reason.toString()}).`)); };
    const cleanup = () => { clearTimeout(timeout); socket.off("message", onMessage); socket.off("error", onError); socket.off("close", onClose); };
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function waitForWebSocketOpen(socket: WebSocket, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for WebSocket open after ${timeoutMs}ms.`)); }, timeoutMs);
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timeout); socket.off("open", onOpen); socket.off("error", onError); };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

function waitForWebSocketClose(socket: WebSocket, timeoutMs = 5_000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for WebSocket close after ${timeoutMs}ms.`)); }, timeoutMs);
    const onClose = (code: number, reason: Buffer) => { cleanup(); resolve({ code, reason: reason.toString() }); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timeout); socket.off("close", onClose); socket.off("error", onError); };
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

async function stop(process: ChildProcess): Promise<void> {
  process.kill("SIGTERM");
  await new Promise<void>((resolve) => process.once("exit", () => resolve()));
}

test("production API startup fails closed without durable database configuration", async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    ALLOWED_ORIGIN: "https://play.example.test",
    PORT: String(24000 + (process.pid % 1000)),
    DATABASE_URL: "",
    PRISMA_DATABASE_URL: "",
    POSTGRES_URL: "",
  };
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  const result = await new Promise<{ code: number | null }>((resolve) => child.once("exit", (code) => resolve({ code })));
  assert.notEqual(result.code, 0);
  assert.match(stderr, /production API requires DATABASE_URL/i);
});

test("leaderboard route narrows categories to the shared contract", async () => {
  const port = 23000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), PERSISTENCE: "memory", ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const invalid = await fetch(`${baseUrl}/leaderboard?category=unknown`);
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "Unknown leaderboard category." });

    for (const category of ["wins", "win-rate", "stomped-tiles", "damage-taken", "health-gained", "luck"]) {
      const response = await fetch(`${baseUrl}/leaderboard?category=${category}`);
      assert.equal(response.status, 200, `${category} should satisfy the shared leaderboard category contract`);
      assert.deepEqual(await response.json(), []);
    }
  } finally {
    await stop(child);
  }
});

test("state afterVersion accepts only non-negative safe integer cursors", async () => {
  const port = 22800 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), PERSISTENCE: "memory", ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createResponse.json() as { room?: RoomPayload; token?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token);

    const stateUrl = `${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`;
    assert.equal((await fetch(stateUrl)).status, 200, "an omitted cursor defaults to zero");
    assert.equal((await fetch(`${stateUrl}&afterVersion=0`)).status, 200);
    assert.equal((await fetch(`${stateUrl}&afterVersion=0003`)).status, 200, "decimal digits with leading zeroes are valid");

    for (const invalid of ["", "nope", "-1", "1.5", "9007199254740992"]) {
      const response = await fetch(`${stateUrl}&afterVersion=${encodeURIComponent(invalid)}`);
      assert.equal(response.status, 400, `afterVersion=${JSON.stringify(invalid)} must be rejected`);
      assert.deepEqual(await response.json(), { error: "afterVersion must be a non-negative safe integer." });
    }
    for (const duplicateQuery of ["afterVersion=0&afterVersion=1", "afterVersion=1&afterVersion=0"]) {
      const response = await fetch(`${stateUrl}&${duplicateQuery}`);
      assert.equal(response.status, 400, `${duplicateQuery} must be rejected regardless of parameter order`);
      assert.deepEqual(await response.json(), { error: "afterVersion may only be supplied once." });
    }
  } finally {
    await stop(child);
  }
});

test("API WebSocket and polling share revisioned room updates", async () => {
  const port = 19000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createResponse.json() as { room?: RoomPayload; token?: string; participantId?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token && created.participantId);
    const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket.ticket)}`);
    await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
    const initialSocketRoom = await nextWebSocketMessage(socket);
    const initialHttpRoom = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    assert.equal(initialSocketRoom.version, initialHttpRoom.version);
    assert.equal(initialSocketRoom.state.setupState?.phase, initialHttpRoom.state.setupState?.phase);

    const updatePromise = nextWebSocketMessage(socket);
    const setupResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ expectedRevision: initialHttpRoom.version, action: { type: "choose-monster", monsterId: "monster-1" } }),
    });
    assert.equal(setupResponse.ok, true);
    const updatedSocketRoom = await updatePromise;
    const polledRoom = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}&afterVersion=${initialHttpRoom.version}`).then((response) => response.json()) as RoomPayload;
    assert.equal(updatedSocketRoom.version, polledRoom.version);
    assert.equal(updatedSocketRoom.version, initialHttpRoom.version + 1);
    assert.deepEqual(updatedSocketRoom.state.setupState, polledRoom.state.setupState);
    assert.equal(polledRoom.events[0]?.version, updatedSocketRoom.version);
    socket.close();
  } finally {
    await stop(child);
  }
});

test("WebSocket command acknowledgement exposes only action metadata, then streams the validated projection", async () => {
  const port = 19100 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createResponse.json() as { room?: RoomPayload & { state: { setupState?: any } }; token?: string; participantId?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token && created.participantId);
    const joinResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Player 2" }) });
    const joined = await joinResponse.json() as { token?: string; participantId?: string; error?: string };
    assert.equal(joinResponse.ok, true, joined.error ?? `Join failed with HTTP ${joinResponse.status}`);
    assert.ok(joined.token && joined.participantId);

    const setup = created.room.state.setupState;
    assert.ok(setup);
    const tokens = [created.token, joined.token];
    let revision = created.room.version;
    const setupAction = async (playerIndex: number, action: unknown) => {
      const response = await fetch(`${baseUrl}/rooms/${created.room!.code}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": tokens[playerIndex]! },
        body: JSON.stringify({ expectedRevision: revision, action }),
      });
      const room = await response.json() as RoomPayload & { error?: string };
      assert.equal(response.ok, true, room.error ?? `Setup failed with HTTP ${response.status}`);
      revision = room.version;
      return room;
    };
    for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
      await setupAction(playerIndex, { type: "choose-monster", monsterId: setup.definition.monsterIds[playerIndex] });
    }
    for (let playerIndex = 1; playerIndex >= 0; playerIndex -= 1) {
      await setupAction(playerIndex, { type: "choose-branch", branch: setup.definition.eligibleBranches[playerIndex] });
    }
    const usedLairs = new Set<string>();
    for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
      const monsterId = setup.definition.monsterIds[playerIndex]!;
      const lair = setup.definition.lairsByMonster[monsterId].find((candidate: string) => !usedLairs.has(candidate));
      assert.ok(lair);
      usedLairs.add(lair);
      await setupAction(playerIndex, { type: "choose-lair", lair });
    }
    for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
      await setupAction(playerIndex, { type: "choose-starting-choice", startingChoice: { kind: "research" } });
    }

    const connect = async (token: string) => {
      const ticket = await createWebSocketTicket(baseUrl, created.room!.code, token);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room!.code}&ticket=${encodeURIComponent(ticket.ticket)}`);
      sockets.push(socket);
      const initialRoom = nextWebSocketMessage(socket);
      await waitForWebSocketOpen(socket);
      await initialRoom;
      return socket;
    };
    const hostSocket = await connect(created.token);
    await connect(joined.token);
    await fetch(`${baseUrl}/rooms/${created.room.code}/ready`, { method: "POST", headers: { "content-type": "application/json", "x-room-token": created.token }, body: JSON.stringify({ ready: true }) });
    const activeUpdate = nextWebSocketMessageMatching(hostSocket, (room) => room.status === "active");
    const finalReadyResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/ready`, { method: "POST", headers: { "content-type": "application/json", "x-room-token": joined.token }, body: JSON.stringify({ ready: true }) });
    const activeRoom = await finalReadyResponse.json() as RoomPayload & { error?: string };
    assert.equal(finalReadyResponse.ok, true, activeRoom.error ?? `Ready failed with HTTP ${finalReadyResponse.status}`);
    await activeUpdate;
    const acceptedMessage = nextWebSocketCommandResult(hostSocket);
    hostSocket.send(JSON.stringify({
      type: "command.submit",
      envelope: {
        actionId: "private-projection-ack-test",
        actorId: created.participantId,
        expectedRevision: activeRoom.version,
        protocolVersion: 1,
        command: { type: "pass-move" },
      },
    }));
    const acknowledgement = await acceptedMessage;
    assert.equal(acknowledgement.type, "command.accepted");
    assert.equal(acknowledgement.actionId, "private-projection-ack-test");
    assert.equal(typeof acknowledgement.version, "number");
    assert.equal(Object.hasOwn(acknowledgement, "room"), false);
    const validatedUpdate = await nextWebSocketMessageMatching(hostSocket, (room) => room.version >= Number(acknowledgement.version));
    assert.ok(validatedUpdate.version >= Number(acknowledgement.version));
  } finally {
    for (const socket of sockets) socket.terminate();
    await stop(child);
  }
});

test("ready endpoint rejects non-boolean input without mutating readiness", async () => {
  const port = 19700 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let socket: WebSocket | undefined;
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createResponse.json() as { room?: RoomPayload; token?: string; participantId?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token && created.participantId);
    const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket.ticket)}`);
    const initialRoom = nextWebSocketMessage(socket);
    await waitForWebSocketOpen(socket);
    await initialRoom;

    const malformedBodies: unknown[] = [{}, { ready: "false" }, { ready: 0 }, { ready: null }, null];
    for (const payload of malformedBodies) {
      const response: Response = await fetch(`${baseUrl}/rooms/${created.room.code}/ready`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": created.token },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "The ready field must be a boolean." });
      const snapshot = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as { participants: Array<{ id: string; ready: boolean }> };
      assert.equal(snapshot.participants.find((participant) => participant.id === created.participantId)?.ready, false);
    }

    for (const ready of [true, false]) {
      const response: Response = await fetch(`${baseUrl}/rooms/${created.room.code}/ready`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": created.token },
        body: JSON.stringify({ ready }),
      });
      const room = await response.json() as RoomPayload & { error?: string };
      assert.equal(response.ok, true, room.error ?? `Ready update failed with HTTP ${response.status}`);
      assert.equal(room.participants.find((participant) => participant.id === created.participantId)?.ready, ready);
    }
  } finally {
    socket?.terminate();
    await stop(child);
  }
});

test("HTTP and WebSocket actions reject malformed command payloads before mutation", async () => {
  const port = 19900 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let socket: WebSocket | undefined;
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createResponse.json() as { room?: RoomPayload; token?: string; participantId?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token && created.participantId);

    const envelope = {
      actionId: "malformed-http-envelope",
      actorId: created.participantId,
      expectedRevision: created.room.version,
      protocolVersion: 1,
      command: { type: "pass-move" },
    };
    const malformedBodies: unknown[] = [
      { actionId: envelope.actionId, actorId: envelope.actorId, expectedRevision: envelope.expectedRevision, protocolVersion: 1 },
      { envelope: { ...envelope, command: null } },
      { envelope: { ...envelope, command: "pass-move" } },
      { envelope: { ...envelope, command: [] } },
      { envelope: { ...envelope, command: {} } },
      { envelope: null, ...envelope },
      ...[
        { type: "made-up-command" },
        { type: "use-monster-ability", ability: "gargantis-heal" },
        { type: "move", path: "los-angeles,denver" },
        { type: "resolve-fight", spendInfamy: "1" },
        { type: "launch-submarine", battleId: "battle-1" },
        { type: "retreat", destinations: [] },
        { type: "use-research", cardId: "Berserk" },
        { type: "deploy", destination: "not-a-hex" },
      ].map((command) => ({ envelope: { ...envelope, command } })),
      {
        actionId: "malformed-flattened-command",
        actorId: envelope.actorId,
        expectedRevision: envelope.expectedRevision,
        protocolVersion: 1,
        command: { type: "use-monster-ability", ability: "gargantis-heal" },
      },
    ];
    for (const payload of malformedBodies) {
      const response: Response = await fetch(`${baseUrl}/rooms/${created.room.code}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": created.token },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Command envelope is invalid." });
    }

    const wellShapedButIllegal = await fetch(`${baseUrl}/rooms/${created.room.code}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ envelope: { ...envelope, actionId: "well-shaped-illegal-command", command: { type: "pass-move" } } }),
    });
    assert.equal(wellShapedButIllegal.status, 400);
    assert.notDeepEqual(await wellShapedButIllegal.json(), { error: "Command envelope is invalid." },
      "well-shaped commands still reach game-state legality checks");

    const snapshotBeforeSocket = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    assert.equal(snapshotBeforeSocket.version, created.room.version);
    assert.equal(snapshotBeforeSocket.events.length, created.room.events.length);

    const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket.ticket)}`);
    await waitForWebSocketOpen(socket);
    await nextWebSocketMessage(socket);
    const protocolResult = nextWebSocketCommandResult(socket);
    socket.send(JSON.stringify({ type: "command.submit", envelope: { ...envelope, actionId: "malformed-websocket-command", command: { type: "use-monster-ability", ability: "gargantis-heal" } } }));
    const rejected = await protocolResult;
    assert.equal(rejected.type, "protocol.error");
    assert.equal(rejected.error, "Unsupported WebSocket message.");

    const snapshotAfterSocket = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    assert.equal(snapshotAfterSocket.version, snapshotBeforeSocket.version);
    assert.equal(snapshotAfterSocket.events.length, snapshotBeforeSocket.events.length);
    const metrics = await fetch(`${baseUrl}/metrics`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(metrics.serverErrors, 0);
  } finally {
    socket?.terminate();
    await stop(child);
  }
});

test("room creation defaults omitted privacy and rejects explicitly invalid values", async () => {
  const port = 20000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const defaultResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const defaultRoom = await defaultResponse.json() as { room?: { privacy?: string }; error?: string };
    assert.equal(defaultResponse.ok, true, defaultRoom.error ?? `Room creation failed with HTTP ${defaultResponse.status}`);
    assert.equal(defaultRoom.room?.privacy, "private");

    for (const privacy of [null, "", "unlisted", 1, false, {}]) {
      const response: Response = await fetch(`${baseUrl}/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPlayers: 2, privacy }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Room privacy must be private or public." });
    }

    const publicRooms = await fetch(`${baseUrl}/rooms/public`).then((response) => response.json()) as unknown[];
    assert.deepEqual(publicRooms, []);
  } finally {
    await stop(child);
  }
});

test("HTTP room lifecycle changes broadcast participant and presence updates to connected clients", async () => {
  const port = 19200 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let socket: WebSocket | undefined;
  let joinedSocket: WebSocket | undefined;
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxPlayers: 2, privacy: "public" }),
    });
    const created = await createResponse.json() as { room?: RoomPayload; token?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token);

    const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket.ticket)}`);
    await new Promise<void>((resolve, reject) => { socket!.once("open", () => resolve()); socket!.once("error", reject); });
    await nextWebSocketMessage(socket);
    // The connecting socket receives a direct snapshot and the room-wide presence broadcast.
    await nextWebSocketMessage(socket);

    const joinedUpdate = nextWebSocketMessage(socket);
    const joinResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Second Player" }),
    });
    const joined = await joinResponse.json() as { token?: string; error?: string };
    assert.equal(joinResponse.ok, true, joined.error ?? `Join failed with HTTP ${joinResponse.status}`);
    assert.ok(joined.token);
    const afterJoin = await joinedUpdate;
    assert.equal(afterJoin.participants.find((participant) => participant.displayName === "Second Player")?.connected, true);

    const ticketBroadcast = nextWebSocketMessage(socket);
    const joinedTicket = await createWebSocketTicket(baseUrl, created.room.code, joined.token);
    assert.equal((await ticketBroadcast).participants.find((participant) => participant.displayName === "Second Player")?.connected, false);
    const joinedSocketUpdate = nextWebSocketMessage(socket);
    joinedSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(joinedTicket.ticket)}`);
    const joinedSocketRoom = nextWebSocketMessage(joinedSocket);
    await waitForWebSocketOpen(joinedSocket);
    await joinedSocketRoom;
    const afterSocketConnect = await joinedSocketUpdate;
    assert.equal(afterSocketConnect.participants.find((participant) => participant.displayName === "Second Player")?.connected, true);

    const spectateUpdate = nextWebSocketMessage(socket);
    const spectateResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/spectate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Room Spectator" }),
    });
    const spectator = await spectateResponse.json() as { token?: string; error?: string };
    assert.equal(spectateResponse.ok, true, spectator.error ?? `Spectate failed with HTTP ${spectateResponse.status}`);
    const afterSpectate = await spectateUpdate;
    assert.equal(afterSpectate.participants.find((participant) => participant.displayName === "Room Spectator")?.role, "spectator");

    const disconnectUpdate = nextWebSocketMessage(socket);
    const disconnectedSocket = waitForWebSocketClose(joinedSocket);
    const disconnectResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": joined.token },
      body: JSON.stringify({ connectionId: joinedTicket.connectionId }),
    });
    assert.equal(disconnectResponse.ok, true);
    const afterDisconnect = await disconnectUpdate;
    assert.equal(afterDisconnect.participants.find((participant) => participant.displayName === "Second Player")?.connected, false);
    assert.equal((await disconnectedSocket).code, 4001);

    const reconnectUpdate = nextWebSocketMessageMatching(socket, (room) => room.participants.find((participant) => participant.displayName === "Second Player")?.connected === true);
    const reconnectResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/reconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": joined.token },
      body: JSON.stringify({ connectionId: joinedTicket.connectionId }),
    });
    assert.equal(reconnectResponse.ok, true);
    const reconnectResult = await reconnectResponse.json() as { connectionId?: string };
    assert.ok(reconnectResult.connectionId && reconnectResult.connectionId !== joinedTicket.connectionId);
    const afterReconnect = await reconnectUpdate;
    assert.equal(afterReconnect.participants.find((participant) => participant.displayName === "Second Player")?.connected, true);
    const staleDisconnect = await fetch(`${baseUrl}/rooms/${created.room.code}/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": joined.token },
      body: JSON.stringify({ connectionId: joinedTicket.connectionId }),
    });
    assert.equal(staleDisconnect.ok, true);
    assert.equal((await staleDisconnect.json() as RoomPayload).participants.find((participant) => participant.displayName === "Second Player")?.connected, true);

    const pendingConnectionId = "11111111-1111-4111-8111-111111111111";
    const leaveDuringReconnect = await fetch(`${baseUrl}/rooms/${created.room.code}/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": joined.token },
      body: JSON.stringify({ connectionId: reconnectResult.connectionId, pendingConnectionId }),
    });
    assert.equal(leaveDuringReconnect.ok, true);
    assert.equal((await leaveDuringReconnect.json() as RoomPayload).participants.find((participant) => participant.displayName === "Second Player")?.connected, false);
    const lateReconnect = await fetch(`${baseUrl}/rooms/${created.room.code}/reconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": joined.token },
      body: JSON.stringify({ connectionId: reconnectResult.connectionId, requestedConnectionId: pendingConnectionId }),
    });
    assert.equal(lateReconnect.status, 400);
    assert.match((await lateReconnect.json() as { error: string }).error, /connection was replaced/);
    const staleFreshLease = await fetch(`${baseUrl}/rooms/${created.room.code}/reconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": joined.token },
      body: JSON.stringify({ requestedConnectionId: "22222222-2222-4222-8222-222222222222" }),
    });
    assert.equal(staleFreshLease.status, 400, "the same room token cannot bypass a cancelled Leave lease");
  } finally {
    socket?.terminate();
    joinedSocket?.terminate();
    await stop(child);
  }
});

test("replacing a room socket and rotating its session close the old private projection stream", async () => {
  const port = 19300 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxPlayers: 2 }),
    });
    const created = await createResponse.json() as { room?: RoomPayload; token?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token);

    const firstTicket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
    const firstSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(firstTicket.ticket)}`);
    sockets.push(firstSocket);
    const firstRoom = nextWebSocketMessage(firstSocket);
    await waitForWebSocketOpen(firstSocket);
    assert.equal((await firstRoom).code, created.room.code);

    const firstSocketClose = waitForWebSocketClose(firstSocket);
    const replacementTicket = await createWebSocketTicket(baseUrl, created.room.code, created.token, firstTicket.connectionId);
    assert.equal((await firstSocketClose).code, 4001);
    const staleTicketResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/ws-ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ connectionId: firstTicket.connectionId }),
    });
    assert.equal(staleTicketResponse.ok, false);
    const replacementSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(replacementTicket.ticket)}`);
    sockets.push(replacementSocket);
    const replacementRoom = nextWebSocketMessage(replacementSocket);
    await waitForWebSocketOpen(replacementSocket);
    assert.equal((await replacementRoom).code, created.room.code);

    const replacementSocketClose = waitForWebSocketClose(replacementSocket);
    const rotateResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/rotate-session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({}),
    });
    const rotated = await rotateResponse.json() as { token?: string; error?: string };
    assert.equal(rotateResponse.ok, true, rotated.error ?? `Session rotation failed with HTTP ${rotateResponse.status}`);
    assert.ok(rotated.token);
    assert.equal((await replacementSocketClose).code, 4001);

    const rotatedTicket = await createWebSocketTicket(baseUrl, created.room.code, rotated.token);
    const rotatedSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(rotatedTicket.ticket)}`);
    sockets.push(rotatedSocket);
    const rotatedRoom = nextWebSocketMessage(rotatedSocket);
    await waitForWebSocketOpen(rotatedSocket);
    assert.equal((await rotatedRoom).code, created.room.code);
    await nextWebSocketMessage(rotatedSocket); // Consume the room-wide update sent after the direct snapshot.

    const joinUpdate = nextWebSocketMessage(rotatedSocket);
    const joinResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "New Player" }),
    });
    assert.equal(joinResponse.ok, true);
    const updatedRoom = await joinUpdate;
    assert.equal(updatedRoom.participants.find((participant) => participant.displayName === "New Player")?.connected, true);
  } finally {
    for (const socket of sockets) socket.terminate();
    await stop(child);
  }
});

test("socket ticket and reconnect requests recover lost acknowledgements without admitting an older tab", async () => {
  const port = 19600 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createResponse.json() as { room?: RoomPayload; token?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token);

    const ticketLease = "11111111-1111-4111-8111-111111111111";
    const lostTicketAcknowledgement = await createWebSocketTicket(baseUrl, created.room.code, created.token, null, ticketLease);
    // Model a lost HTTP acknowledgement: retry the same persisted proposal.
    const recoveredTicket = await createWebSocketTicket(baseUrl, created.room.code, created.token, null, ticketLease);
    assert.equal(recoveredTicket.connectionId, lostTicketAcknowledgement.connectionId);
    assert.notEqual(recoveredTicket.ticket, lostTicketAcknowledgement.ticket);

    const staleTabResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/ws-ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ connectionId: null, requestedConnectionId: "22222222-2222-4222-8222-222222222222" }),
    });
    assert.equal(staleTabResponse.ok, false);

    const reconnectBody = { connectionId: ticketLease, requestedConnectionId: "33333333-3333-4333-8333-333333333333" };
    const reconnect = await fetch(`${baseUrl}/rooms/${created.room.code}/reconnect`, {
      method: "POST", headers: { "content-type": "application/json", "x-room-token": created.token }, body: JSON.stringify(reconnectBody),
    });
    const reconnectResult = await reconnect.json() as { connectionId?: string; error?: string };
    assert.equal(reconnect.ok, true, reconnectResult.error ?? `Reconnect failed with HTTP ${reconnect.status}`);
    assert.equal(reconnectResult.connectionId, reconnectBody.requestedConnectionId);
    const retriedReconnect = await fetch(`${baseUrl}/rooms/${created.room.code}/reconnect`, {
      method: "POST", headers: { "content-type": "application/json", "x-room-token": created.token }, body: JSON.stringify(reconnectBody),
    });
    const retriedReconnectResult = await retriedReconnect.json() as { connectionId?: string; error?: string };
    assert.equal(retriedReconnect.ok, true, retriedReconnectResult.error ?? `Reconnect retry failed with HTTP ${retriedReconnect.status}`);
    assert.equal(retriedReconnectResult.connectionId, reconnectBody.requestedConnectionId);
  } finally {
    await stop(child);
  }
});

test("API responses expose the documented security and CORS headers", async () => {
  const port = 19500 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true", ALLOWED_ORIGIN: "https://example.test" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("access-control-allow-origin"), "https://example.test");
    const preflight = await fetch(`${baseUrl}/health`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET,POST,PATCH,DELETE,OPTIONS");
    assert.equal(preflight.headers.get("access-control-allow-headers"), "content-type,x-room-token");

    const forgedSimpleResume = await fetch(`${baseUrl}/accounts/me/games/room-1/resume`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "text/plain", cookie: "aaa_account=fixture-session" },
      body: "{}",
    });
    assert.equal(forgedSimpleResume.status, 403, "an untrusted simple cross-origin account POST is rejected before recovery can run");
    const configuredOriginResume = await fetch(`${baseUrl}/accounts/me/games/room-1/resume`, {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "text/plain", cookie: "aaa_account=fixture-session" },
      body: "{}",
    });
    assert.equal(configuredOriginResume.status, 503, "the configured web origin reaches the normal persistence availability check");

    const forgedSimpleClaim = await fetch(`${baseUrl}/rooms/room-1/claim`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "text/plain", cookie: "aaa_account=fixture-session" },
      body: "{}",
    });
    assert.equal(forgedSimpleClaim.status, 403, "an untrusted account-linking request is rejected before persistence checks");
    const configuredOriginClaim = await fetch(`${baseUrl}/rooms/room-1/claim`, {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "text/plain", cookie: "aaa_account=fixture-session" },
      body: "{}",
    });
    assert.equal(configuredOriginClaim.status, 503, "the configured origin reaches the normal account-linking availability check");
    const noOriginClaim = await fetch(`${baseUrl}/rooms/room-1/claim`, {
      method: "POST",
      headers: { "content-type": "text/plain", cookie: "aaa_account=fixture-session" },
      body: "{}",
    });
    assert.equal(noOriginClaim.status, 503, "non-browser account linking without an Origin header reaches the availability check");
  } finally {
    await stop(child);
  }
});

test("HTTP rate-limit responses retain CORS headers for the configured browser origin", async () => {
  const port = 19400 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true", ALLOWED_ORIGIN: "https://example.test" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 130; attempt += 1) {
      const response = await fetch(`${baseUrl}/health`, { headers: { origin: "https://example.test" } });
      if (response.status === 429) {
        limited = response;
        break;
      }
      assert.equal(response.status, 200, `expected an ordinary health response before the limit; got ${response.status}`);
    }
    assert.ok(limited, "the configured HTTP limit should be reached");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal(limited.headers.get("access-control-allow-origin"), "https://example.test");
    assert.equal(limited.headers.get("access-control-allow-credentials"), "true");
    assert.equal(limited.headers.get("vary"), "Origin");
    assert.deepEqual(await limited.json(), { error: "Too many requests. Try again shortly." });
  } finally {
    await stop(child);
  }
});

test("WebSocket rejects a mismatched Origin before consuming its ticket and permits absent Origin", async () => {
  const port = 19300 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true", ALLOWED_ORIGIN: "https://play.example.test" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForHealth(baseUrl);
    const createRoom = async () => {
      const response = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
      const result = await response.json() as { room?: RoomPayload; token?: string; error?: string };
      assert.equal(response.ok, true, result.error ?? `Room creation failed with HTTP ${response.status}`);
      assert.ok(result.room && result.token);
      return { room: result.room, token: result.token };
    };

    const withOrigin = await createRoom();
    const ticket = await createWebSocketTicket(baseUrl, withOrigin.room.code, withOrigin.token);
    const url = `ws://127.0.0.1:${port}/ws?code=${withOrigin.room.code}&ticket=${encodeURIComponent(ticket.ticket)}`;
    const rejected = new WebSocket(url, { headers: { Origin: "https://attacker.example" } });
    sockets.push(rejected);
    const rejectionStatus = await new Promise<number>((resolve, reject) => {
      rejected.once("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); });
      rejected.once("error", reject);
    });
    assert.equal(rejectionStatus, 403);

    const accepted = new WebSocket(url, { headers: { Origin: "https://play.example.test" } });
    sockets.push(accepted);
    const initialRoom = nextWebSocketMessage(accepted);
    await waitForWebSocketOpen(accepted);
    assert.equal((await initialRoom).code, withOrigin.room.code, "the rejected handshake did not consume the one-use ticket");

    const withoutOrigin = await createRoom();
    const noOriginTicket = await createWebSocketTicket(baseUrl, withoutOrigin.room.code, withoutOrigin.token);
    const nonBrowserSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${withoutOrigin.room.code}&ticket=${encodeURIComponent(noOriginTicket.ticket)}`);
    sockets.push(nonBrowserSocket);
    const nonBrowserRoom = nextWebSocketMessage(nonBrowserSocket);
    await waitForWebSocketOpen(nonBrowserSocket);
    assert.equal((await nonBrowserRoom).code, withoutOrigin.room.code);
  } finally {
    for (const socket of sockets) socket.terminate();
    await stop(child);
  }
});

test("metrics expose redacted error counters without private room data", async () => {
  const port = 19800 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const initial = await fetch(`${baseUrl}/metrics`).then((response) => response.json()) as Record<string, unknown>;
    for (const key of ["errorReports", "divergenceReports", "deploymentFailures"]) {
      assert.equal(typeof initial[key], "number", `missing numeric ${key}`);
      assert.equal(initial[key], 0);
    }

    const malformed = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);

    const observed = await fetch(`${baseUrl}/metrics`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(observed.errorReports, 1);
    assert.equal(observed.divergenceReports, 0);
    assert.equal(observed.deploymentFailures, 0);
    assert.equal(Object.hasOwn(observed, "token"), false);
    assert.equal(Object.hasOwn(observed, "state"), false);
  } finally {
    await stop(child);
  }
});

test("public room discovery is available without a room token and omits private room data", async () => {
  const port = 19600 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const publicRoomResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 3, privacy: "public" }) });
    const privateRoomResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2, privacy: "private" }) });
    assert.equal(publicRoomResponse.ok, true);
    assert.equal(privateRoomResponse.ok, true);
    const discoveryResponse = await fetch(`${baseUrl}/rooms/public`);
    assert.equal(discoveryResponse.status, 200);
    const rooms = await discoveryResponse.json() as Array<Record<string, unknown>>;
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0]?.maxPlayers, 3);
    assert.equal(Object.hasOwn(rooms[0]!, "state"), false);
    assert.equal(Object.hasOwn(rooms[0]!, "token"), false);
  } finally {
    await stop(child);
  }
});

test("documented public and room routes reject extra path segments", async () => {
  const port = 19900 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const publicRooms = await fetch(`${baseUrl}/rooms/public`);
    assert.equal(publicRooms.status, 200);
    assert.equal((await fetch(`${baseUrl}/rooms/public/extra`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/health/extra`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/metrics/extra`)).status, 404);

    const createResponse = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxPlayers: 2 }),
    });
    const created = await createResponse.json() as { room: RoomPayload; token: string };
    assert.equal(createResponse.status, 201);

    const extraJoin = await fetch(`${baseUrl}/rooms/${created.room.code}/join/extra`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Must not join" }),
    });
    assert.equal(extraJoin.status, 404);
    const room = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    assert.equal(room.participants.length, 1, "the rejected suffix route must not mutate the room");
    assert.equal((await fetch(`${baseUrl}/rooms/${created.room.code}/state/extra?token=${encodeURIComponent(created.token)}`)).status, 404);
  } finally {
    await stop(child);
  }
});

test("known domain failures stay client errors and do not increment server-error metrics", async () => {
  const port = 19850 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/rooms/UNKNOWN/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Player" }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Room not found." });
    const metrics = await fetch(`${baseUrl}/metrics`).then((result) => result.json()) as Record<string, unknown>;
    assert.equal(metrics.serverErrors, 0);
  } finally {
    await stop(child);
  }
});

test("unexpected persistence failures return a generic 500 and increment server-error metrics", async () => {
  const port = 19950 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      PERSISTENCE: "prisma",
      ALLOW_DEVELOPMENT_FIXTURE: "true",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test?connect_timeout=1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForMetrics(baseUrl);
    const healthResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 503);
    assert.deepEqual(await healthResponse.json(), { ok: false, error: "Persistence health check failed" });
    const response = await fetch(`${baseUrl}/rooms/public`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Request failed." });
    const metrics = await fetch(`${baseUrl}/metrics`).then((result) => result.json()) as Record<string, unknown>;
    assert.equal(metrics.serverErrors, 2);
    assert.equal(metrics.requestFailures, 2);
  } finally {
    await stop(child);
  }
});

test("API rejects oversized JSON bodies before mutating a room", async () => {
  const port = 19700 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxPlayers: 2, padding: "x".repeat(70_000) }),
    });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /too large/i);
  } finally {
    await stop(child);
  }
});

test("bounded concurrent rooms fan out WebSocket and polling updates without cross-room state", async () => {
  const port = 20000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForHealth(baseUrl);
    const sessions = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const response = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2, privacy: "public" }) });
      const created = await response.json() as { room: RoomPayload; token: string; participantId: string };
      assert.equal(response.ok, true);
      const spectatorResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/spectate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: `Spectator ${index}` }) });
      const spectator = await spectatorResponse.json() as { token: string };
      assert.equal(spectatorResponse.ok, true);
      const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket.ticket)}`);
      sockets.push(socket);
      const initialSocketPromise = nextWebSocketMessage(socket);
      await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
      const initialSocketRoom = await initialSocketPromise;
      const [polledHost, polledSpectator] = await Promise.all([
        fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as Promise<RoomPayload>,
        fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(spectator.token)}`).then((result) => result.json()) as Promise<RoomPayload>,
      ]);
      assert.equal(initialSocketRoom.code, created.room.code);
      assert.equal(polledHost.code, created.room.code);
      assert.equal(polledSpectator.code, created.room.code);
      assert.deepEqual(polledSpectator.state.setupState, polledHost.state.setupState);
      return { ...created, socket, version: polledHost.version };
    }));

    const updated = await Promise.all(sessions.map(async (session) => {
      const updatePromise = nextWebSocketMessage(session.socket);
      const response = await fetch(`${baseUrl}/rooms/${session.room.code}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": session.token },
        body: JSON.stringify({ expectedRevision: session.version, action: { type: "choose-monster", monsterId: "monster-1" } }),
      });
      assert.equal(response.ok, true);
      const [socketRoom, polledRoom] = await Promise.all([
        updatePromise,
        fetch(`${baseUrl}/rooms/${session.room.code}/state?token=${encodeURIComponent(session.token)}&afterVersion=${session.version}`).then((result) => result.json()) as Promise<RoomPayload>,
      ]);
      assert.equal(socketRoom.code, session.room.code);
      assert.equal(socketRoom.version, session.version + 1);
      assert.equal(polledRoom.version, socketRoom.version);
      assert.deepEqual(polledRoom.state.setupState, socketRoom.state.setupState);
      return socketRoom;
    }));
    assert.equal(new Set(updated.map((room) => room.code)).size, sessions.length);
  } finally {
    for (const socket of sockets) socket.terminate();
    await stop(child);
  }
});

test("same-room command contention commits one revision and rejects the rest", async () => {
  const port = 20500 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const createdResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createdResponse.json() as { room: RoomPayload; token: string; participantId: string };
    assert.equal(createdResponse.ok, true);
    const initial = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    const results = await Promise.all(["contended-a", "contended-b", "contended-c", "contended-d"].map((actionId) => fetch(`${baseUrl}/rooms/${created.room.code}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ expectedRevision: initial.version, action: { type: "choose-monster", monsterId: "monster-1" }, actionId }),
    })));
    assert.equal(results.filter((response) => response.ok).length, 1);
    assert.equal(results.filter((response) => response.status === 400).length, 3);
    const settled = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    assert.equal(settled.version, initial.version + 1);
    assert.deepEqual(settled.events.map((event) => event.version), [settled.version]);
  } finally {
    await stop(child);
  }
});

test("bounded reconnect storm restores the same room revision without duplicate actions", async () => {
  const port = 21000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxPlayers: 2 }),
    });
    const created = await response.json() as { room: RoomPayload; token: string; participantId: string };
    assert.equal(response.ok, true);

    const initial = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as RoomPayload;
    const setupResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ expectedRevision: initial.version, action: { type: "choose-monster", monsterId: "monster-1" } }),
    });
    assert.equal(setupResponse.ok, true);
    const settled = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as RoomPayload;

    const restored: number[] = [];
    let previousSocket: WebSocket | undefined;
    let previousConnectionId: string | null = null;
    for (let index = 0; index < 12; index += 1) {
      if (previousSocket) {
        const replaced = waitForWebSocketClose(previousSocket);
        const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token, previousConnectionId);
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket.ticket)}`);
        sockets.push(socket);
        const socketRoomPromise = nextWebSocketMessage(socket);
        await waitForWebSocketOpen(socket);
        const [socketRoom, polledRoom] = await Promise.all([
          socketRoomPromise,
          fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as Promise<RoomPayload>,
        ]);
        assert.equal((await replaced).code, 4001);
        assert.equal(socketRoom.version, settled.version);
        assert.equal(polledRoom.version, settled.version);
        assert.deepEqual(socketRoom.state.setupState, polledRoom.state.setupState);
        restored.push(socketRoom.version);
        previousSocket = socket;
        previousConnectionId = ticket.connectionId;
        continue;
      }
      const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket.ticket)}`);
      sockets.push(socket);
      const socketRoomPromise = nextWebSocketMessage(socket);
      await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
      const [socketRoom, polledRoom] = await Promise.all([
        socketRoomPromise,
        fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as Promise<RoomPayload>,
      ]);
      assert.equal(socketRoom.version, settled.version);
      assert.equal(polledRoom.version, settled.version);
      assert.deepEqual(socketRoom.state.setupState, polledRoom.state.setupState);
      restored.push(socketRoom.version);
      previousSocket = socket;
      previousConnectionId = ticket.connectionId;
    }
    assert.deepEqual(new Set(restored), new Set([settled.version]));
  } finally {
    for (const socket of sockets) socket.terminate();
    await stop(child);
  }
});
