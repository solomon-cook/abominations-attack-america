import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const roomCount = Number(process.env.LOAD_ROOMS ?? 8);
const reconnectsPerRoom = Number(process.env.LOAD_RECONNECTS ?? 2);
const sustainedDurationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 10);
const pollIntervalMs = Number(process.env.LOAD_POLL_INTERVAL_MS ?? 250);
const reconnectEveryRounds = Number(process.env.LOAD_RECONNECT_EVERY_ROUNDS ?? 4);
const persistence = process.env.LOAD_PERSISTENCE ?? "memory";
if (persistence !== "memory" && persistence !== "prisma") throw new Error("LOAD_PERSISTENCE must be memory or prisma.");
if (persistence === "prisma" && !(process.env.DATABASE_URL ?? process.env.PRISMA_DATABASE_URL ?? process.env.POSTGRES_URL)?.trim()) {
  throw new Error("LOAD_PERSISTENCE=prisma requires DATABASE_URL, PRISMA_DATABASE_URL, or POSTGRES_URL.");
}
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
let apiStderr = "";
let apiStdout = "";

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

async function openSocket(code, token) {
  const ticketResponse = await fetch(`${baseUrl}/rooms/${code}/ws-ticket`, {
    method: "POST",
    headers: { "x-room-token": token },
  });
  const ticketResult = await ticketResponse.json();
  if (!ticketResponse.ok || typeof ticketResult.ticket !== "string") throw new Error(`WebSocket ticket for ${code} failed: ${ticketResult.error ?? ticketResponse.status}`);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${code}&ticket=${encodeURIComponent(ticketResult.ticket)}`);
  const firstMessage = new Promise((resolve, reject) => {
    const onMessage = (data) => { cleanup(); resolve(JSON.parse(data.toString()).room); };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = (closeCode, reason) => { cleanup(); reject(new Error(`WebSocket for ${code} closed before its first update (code ${closeCode}${reason.length ? `, ${reason.toString()}` : ""}).`)); };
    const cleanup = () => { socket.off("message", onMessage); socket.off("error", onError); socket.off("close", onClose); };
    socket.once("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
  const opened = new Promise((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = (closeCode, reason) => { cleanup(); reject(new Error(`WebSocket for ${code} closed before opening (code ${closeCode}${reason.length ? `, ${reason.toString()}` : ""}).`)); };
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
    body: JSON.stringify({ maxPlayers: 2, privacy: "public" }),
  });
  const created = await response.json();
  if (!response.ok) throw new Error(`Room ${index} creation failed: ${created.error ?? response.status}`);
  const joinedResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: `Load player ${index}` }),
  });
  const joined = await joinedResponse.json();
  if (!joinedResponse.ok) throw new Error(`Room ${index} second seat failed: ${joined.error ?? joinedResponse.status}`);
  const startResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/start`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-room-token": created.token },
    body: "{}",
  });
  const started = await startResponse.json();
  if (!startResponse.ok) throw new Error(`Room ${index} start failed: ${started.error ?? startResponse.status}`);
  const spectatorResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/spectate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: `Load spectator ${index}` }),
  });
  const spectator = await spectatorResponse.json();
  if (!spectatorResponse.ok) throw new Error(`Room ${index} spectator failed: ${spectator.error ?? spectatorResponse.status}`);
  const host = await openSocket(created.room.code, created.token);
  const spectatorSocket = await openSocket(created.room.code, spectator.token);
  await Promise.all([
    withTimeout(host.opened, `Room ${index} host WebSocket open`),
    withTimeout(spectatorSocket.opened, `Room ${index} spectator WebSocket open`),
  ]);
  const [initialSocketRoom, initialSpectatorRoom] = await Promise.all([
    withTimeout(host.firstMessage, `Room ${index} initial host WebSocket update`),
    withTimeout(spectatorSocket.firstMessage, `Room ${index} initial spectator WebSocket update`),
  ]);
  const [hostRoom, spectatorRoom] = await Promise.all([
    fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()),
    fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(spectator.token)}`).then((result) => result.json()),
  ]);
  if (initialSocketRoom.version !== hostRoom.version || initialSpectatorRoom.version !== spectatorRoom.version || hostRoom.version !== spectatorRoom.version) throw new Error(`Room ${index} initial WebSocket/polling revision diverged.`);
  const setup = hostRoom.state.setupState;
  const setupSeat = setup?.seats.find((seat) => !seat.monsterId);
  const selectedMonsterId = setup?.definition.monsterIds.find((monsterId) => !setup.seats.some((seat) => seat.monsterId === monsterId));
  if (!setupSeat || !selectedMonsterId) throw new Error(`Room ${index} has no legal first monster-selection action.`);
  const setupParticipantId = setupSeat.playerIndex === 0 ? created.participantId : joined.participantId;
  const setupToken = setupSeat.playerIndex === 0 ? created.token : joined.token;
  const setupOwnerView = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(setupToken)}`).then((result) => result.json());
  const authenticatedSeat = setupOwnerView.participants?.find((participant) => participant.id === setupParticipantId)?.playerIndex;
  if (authenticatedSeat !== setupSeat.playerIndex) throw new Error(`Room ${index} setup token does not resolve to the selected seat ${setupSeat.playerIndex}.`);
  return { code: created.room.code, token: created.token, setupToken, setupActorIndex: setupSeat.playerIndex, selectedMonsterId, spectatorToken: spectator.token, version: hostRoom.version, hostSocket: host.socket, spectatorSocket: spectatorSocket.socket };
}

async function main() {
  if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 32) throw new Error("LOAD_ROOMS must be an integer from 1 to 32.");
  if (!Number.isInteger(reconnectsPerRoom) || reconnectsPerRoom < 1 || reconnectsPerRoom > 16) throw new Error("LOAD_RECONNECTS must be an integer from 1 to 16.");
  if (!Number.isInteger(sustainedDurationSeconds) || sustainedDurationSeconds < 5 || sustainedDurationSeconds > 120) throw new Error("LOAD_DURATION_SECONDS must be an integer from 5 to 120.");
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 50 || pollIntervalMs > 5_000) throw new Error("LOAD_POLL_INTERVAL_MS must be an integer from 50 to 5000.");
  if (!Number.isInteger(reconnectEveryRounds) || reconnectEveryRounds < 1 || reconnectEveryRounds > 100) throw new Error("LOAD_RECONNECT_EVERY_ROUNDS must be an integer from 1 to 100.");
  const childEnvironment = {
    ...process.env,
    PORT: String(port),
    PERSISTENCE: persistence,
    ALLOW_DEVELOPMENT_FIXTURE: "true",
    // The harness accepts up to 32 concurrent rooms. Keep the development-only
    // limits above the maximum polling/reconnect workload so they don't become
    // the bottleneck; production defaults remain unchanged.
    DEVELOPMENT_API_RATE_LIMIT: "50000",
    DEVELOPMENT_WS_RATE_LIMIT: "5000",
  };
  if (persistence === "memory") {
    childEnvironment.DATABASE_URL = "";
    childEnvironment.PRISMA_DATABASE_URL = "";
    childEnvironment.POSTGRES_URL = "";
  }
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("../apps/api", import.meta.url),
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { apiStdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { apiStderr += chunk.toString(); });
  const sockets = [];
  try {
    await waitForHealth();
    const sessions = await Promise.all(Array.from({ length: roomCount }, (_, index) => createRoom(index)));
    sockets.push(...sessions.flatMap((session) => [session.hostSocket, session.spectatorSocket]));
    await Promise.all(sessions.map(async (session) => {
      const setupResponse = await fetch(`${baseUrl}/rooms/${session.code}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": session.setupToken },
        body: JSON.stringify({ expectedRevision: session.version, action: { type: "choose-monster", monsterId: session.selectedMonsterId }, actionId: `load-${session.code}` }),
      });
      if (!setupResponse.ok) {
        const failure = await setupResponse.json();
        throw new Error(`Room ${session.code} setup command for player ${session.setupActorIndex} failed: ${failure.error ?? setupResponse.status}.`);
      }
      const settled = await fetch(`${baseUrl}/rooms/${session.code}/state?token=${encodeURIComponent(session.token)}`).then((result) => result.json());
      if (settled.version !== session.version + 1) throw new Error(`Room ${session.code} did not advance exactly once.`);
      for (let index = 0; index < reconnectsPerRoom; index += 1) {
        const restored = await openSocket(session.code, session.token);
        sockets.push(restored.socket);
        await withTimeout(restored.opened, `Room ${session.code} reconnect ${index + 1} WebSocket open`);
        const socketRoom = await withTimeout(restored.firstMessage, `Room ${session.code} reconnect ${index + 1} update`);
        const polledRoom = await fetch(`${baseUrl}/rooms/${session.code}/state?token=${encodeURIComponent(session.token)}`).then((result) => result.json());
        if (socketRoom.version !== settled.version || polledRoom.version !== settled.version) throw new Error(`Room ${session.code} reconnect ${index + 1} diverged.`);
        restored.socket.close();
      }
    }));

    const sustainedStartedAt = Date.now();
    const sustainedDeadline = sustainedStartedAt + sustainedDurationSeconds * 1_000;
    let pollRounds = 0;
    let stateReads = 0;
    let sustainedReconnects = 0;
    while (Date.now() < sustainedDeadline) {
      await Promise.all(sessions.map(async (session) => {
        const [hostRoom, spectatorRoom] = await Promise.all([
          fetch(`${baseUrl}/rooms/${session.code}/state?token=${encodeURIComponent(session.token)}`).then((result) => result.json()),
          fetch(`${baseUrl}/rooms/${session.code}/state?token=${encodeURIComponent(session.spectatorToken)}`).then((result) => result.json()),
        ]);
        stateReads += 2;
        if (hostRoom.version !== session.version + 1 || spectatorRoom.version !== session.version + 1) {
          throw new Error(`Room ${session.code} sustained polling diverged from its committed revision.`);
        }
      }));
      pollRounds += 1;

      if (pollRounds % reconnectEveryRounds === 0) {
        await Promise.all(sessions.map(async (session) => {
          closeSocket(session.hostSocket);
          closeSocket(session.spectatorSocket);
          const [host, spectator] = await Promise.all([
            openSocket(session.code, session.token),
            openSocket(session.code, session.spectatorToken),
          ]);
          sockets.push(host.socket, spectator.socket);
          await Promise.all([
            withTimeout(host.opened, `Room ${session.code} sustained host reconnect`),
            withTimeout(spectator.opened, `Room ${session.code} sustained spectator reconnect`),
          ]);
          const [hostUpdate, spectatorUpdate] = await Promise.all([
            withTimeout(host.firstMessage, `Room ${session.code} sustained host revision`),
            withTimeout(spectator.firstMessage, `Room ${session.code} sustained spectator revision`),
          ]);
          if (hostUpdate.version !== session.version + 1 || spectatorUpdate.version !== session.version + 1) {
            throw new Error(`Room ${session.code} sustained WebSocket reconnect diverged from its committed revision.`);
          }
          session.hostSocket = host.socket;
          session.spectatorSocket = spectator.socket;
          sustainedReconnects += 2;
        }));
      }
      if (Date.now() < sustainedDeadline) await wait(pollIntervalMs);
    }

    const metrics = await fetch(`${baseUrl}/metrics`).then((result) => result.json());
    if (!metrics || typeof metrics !== "object") throw new Error("Metrics endpoint did not return an object.");
    if (metrics.requestFailures !== 0 || metrics.serverErrors !== 0 || metrics.websocketFailures !== 0) {
      throw new Error(`Load run reported failures: requests=${metrics.requestFailures}, server=${metrics.serverErrors}, WebSocket=${metrics.websocketFailures}.`);
    }
    const sustainedElapsedSeconds = ((Date.now() - sustainedStartedAt) / 1_000).toFixed(1);
    console.log(`Verified ${persistence} API load: ${roomCount} concurrent rooms with host and spectator sessions, ${reconnectsPerRoom} initial reconnects per room, then ${sustainedElapsedSeconds}s sustained polling (${pollRounds} rounds, ${stateReads} reads) and ${sustainedReconnects} additional WebSocket reconnects; no API or WebSocket failures.`);
  } finally {
    for (const socket of sockets) closeSocket(socket);
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await withTimeout(new Promise((resolve) => child.once("exit", resolve)), "Development API shutdown");
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (apiStdout.trim()) console.error(`Development API stdout:\n${apiStdout.trim()}`);
  if (apiStderr.trim()) console.error(`Development API stderr:\n${apiStderr.trim()}`);
  process.exitCode = 1;
});
