import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { WebSocket } from "ws";

type RoomPayload = { code: string; version: number; state: { setupState?: { phase: string; seats: Array<{ monsterId?: string }> } }; events: Array<{ version: number }> };

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

function nextWebSocketMessage(socket: WebSocket): Promise<RoomPayload> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      cleanup();
      const message = JSON.parse(data.toString()) as { type: string; room: RoomPayload };
      resolve(message.room);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { socket.off("message", onMessage); socket.off("error", onError); };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

async function stop(process: ChildProcess): Promise<void> {
  process.kill("SIGTERM");
  await new Promise<void>((resolve) => process.once("exit", () => resolve()));
}

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
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&token=${encodeURIComponent(created.token)}`);
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
      const response = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
      const created = await response.json() as { room: RoomPayload; token: string; participantId: string };
      assert.equal(response.ok, true);
      const spectatorResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/spectate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: `Spectator ${index}` }) });
      const spectator = await spectatorResponse.json() as { token: string };
      assert.equal(spectatorResponse.ok, true);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&token=${encodeURIComponent(created.token)}`);
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

    const restored = await Promise.all(Array.from({ length: 12 }, async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&token=${encodeURIComponent(created.token)}`);
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
      socket.close();
      return socketRoom.version;
    }));
    assert.deepEqual(new Set(restored), new Set([settled.version]));
  } finally {
    for (const socket of sockets) socket.terminate();
    await stop(child);
  }
});
