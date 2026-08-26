import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const roomCount = Number(process.env.LOAD_ROOMS ?? 8);
const reconnectsPerRoom = Number(process.env.LOAD_RECONNECTS ?? 2);
const port = 22000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const closeSocket = (socket) => {
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.terminate();
  } catch {
    // A failed load setup may leave a socket between connection states; cleanup must not mask the primary error.
  }
};
const withTimeout = (promise, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out.`)), 5_000)),
]);

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // The server may still be binding its port.
    }
    await wait(25);
  }
  throw new Error("Development API did not become healthy in time.");
}

function openSocket(code, token) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${code}&token=${encodeURIComponent(token)}`);
  const firstMessage = new Promise((resolve, reject) => {
    const onMessage = (data) => { cleanup(); resolve(JSON.parse(data.toString()).room); };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error(`WebSocket for ${code} closed before its first update.`)); };
    const cleanup = () => { socket.off("message", onMessage); socket.off("error", onError); socket.off("close", onClose); };
    socket.once("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
  const opened = new Promise((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error(`WebSocket for ${code} closed before opening.`)); };
    const cleanup = () => { socket.off("open", onOpen); socket.off("error", onError); socket.off("close", onClose); };
    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
  return { socket, opened, firstMessage };
}

async function createRoom(index) {
  const response = await fetch(`${baseUrl}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxPlayers: 2 }),
  });
  const created = await response.json();
  if (!response.ok) throw new Error(`Room ${index} creation failed: ${created.error ?? response.status}`);
  const spectatorResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/spectate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: `Load spectator ${index}` }),
  });
  const spectator = await spectatorResponse.json();
  if (!spectatorResponse.ok) throw new Error(`Room ${index} spectator failed: ${spectator.error ?? spectatorResponse.status}`);
  const host = openSocket(created.room.code, created.token);
  await withTimeout(host.opened, `Room ${index} WebSocket open`);
  const initialSocketRoom = await withTimeout(host.firstMessage, `Room ${index} initial WebSocket update`);
  const [hostRoom, spectatorRoom] = await Promise.all([
    fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()),
    fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(spectator.token)}`).then((result) => result.json()),
  ]);
  if (initialSocketRoom.version !== hostRoom.version || hostRoom.version !== spectatorRoom.version) throw new Error(`Room ${index} initial WebSocket/polling revision diverged.`);
  return { code: created.room.code, token: created.token, version: hostRoom.version, hostSocket: host.socket };
}

async function main() {
  if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 32) throw new Error("LOAD_ROOMS must be an integer from 1 to 32.");
  if (!Number.isInteger(reconnectsPerRoom) || reconnectsPerRoom < 1 || reconnectsPerRoom > 16) throw new Error("LOAD_RECONNECTS must be an integer from 1 to 16.");
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("../apps/api", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      ALLOW_DEVELOPMENT_FIXTURE: "true",
      DEVELOPMENT_API_RATE_LIMIT: "10000",
      DEVELOPMENT_WS_RATE_LIMIT: "1000",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets = [];
  try {
    await waitForHealth();
    const sessions = await Promise.all(Array.from({ length: roomCount }, (_, index) => createRoom(index)));
    sockets.push(...sessions.map((session) => session.hostSocket));
    await Promise.all(sessions.map(async (session) => {
      const setupResponse = await fetch(`${baseUrl}/rooms/${session.code}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": session.token },
        body: JSON.stringify({ expectedRevision: session.version, action: { type: "choose-monster", monsterId: "monster-1" }, actionId: `load-${session.code}` }),
      });
      if (!setupResponse.ok) throw new Error(`Room ${session.code} setup command failed.`);
      const settled = await fetch(`${baseUrl}/rooms/${session.code}/state?token=${encodeURIComponent(session.token)}`).then((result) => result.json());
      if (settled.version !== session.version + 1) throw new Error(`Room ${session.code} did not advance exactly once.`);
      for (let index = 0; index < reconnectsPerRoom; index += 1) {
        const restored = openSocket(session.code, session.token);
        sockets.push(restored.socket);
        await withTimeout(restored.opened, `Room ${session.code} reconnect ${index + 1} WebSocket open`);
        const socketRoom = await withTimeout(restored.firstMessage, `Room ${session.code} reconnect ${index + 1} update`);
        const polledRoom = await fetch(`${baseUrl}/rooms/${session.code}/state?token=${encodeURIComponent(session.token)}`).then((result) => result.json());
        if (socketRoom.version !== settled.version || polledRoom.version !== settled.version) throw new Error(`Room ${session.code} reconnect ${index + 1} diverged.`);
        restored.socket.close();
      }
    }));
    const metrics = await fetch(`${baseUrl}/metrics`).then((result) => result.json());
    if (!metrics || typeof metrics !== "object") throw new Error("Metrics endpoint did not return an object.");
    console.log(`Verified bounded development API load: ${roomCount} concurrent rooms, spectators, WebSocket/polling parity, one command per room, and ${reconnectsPerRoom} reconnects per room.`);
  } finally {
    for (const socket of sockets) closeSocket(socket);
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await withTimeout(new Promise((resolve) => child.once("exit", resolve)), "Development API shutdown");
    }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
