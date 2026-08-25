import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createGame, deployUnit, getLocation, locations, moveMonster, resolveEncounter, resolveFight, type GameState } from "@abominations/game-engine";
import type { RoomView, SessionResponse } from "@abominations/shared";
import { createRoom, joinRoom, readRoom, sendCommand, spectateRoom, websocketUrl } from "./api";
import "./styles.css";

const boardRows = 12;
const boardCols = 19;
const waterEdge = new Set(["0-0", "0-1", "0-2", "0-3", "0-17", "0-18", "1-0", "1-1", "1-18", "2-0", "2-18", "3-0", "3-18", "4-0", "4-18", "5-0", "5-18", "6-0", "6-18", "7-0", "7-18", "8-0", "8-18", "9-0", "9-1", "9-17", "9-18", "10-0", "10-1", "10-17", "10-18", "11-0", "11-1", "11-2", "11-16", "11-17", "11-18"]);
const boardHexes = Array.from({ length: boardRows * boardCols }, (_, index) => {
  const row = Math.floor(index / boardCols);
  const col = index % boardCols;
  return { row, col, water: waterEdge.has(`${row}-${col}`) };
});

function App() {
  const [game, setGame] = useState<GameState>(() => createGame(2));
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const online = Boolean(session && room);
  const activeGame = room?.state ?? game;
  const activePlayer = activeGame.monsters[activeGame.currentPlayer];
  const activeLocation = getLocation(activePlayer.location);
  const action = activeGame.phase === "move" ? "Move" : activeGame.phase === "fight" ? "Fight" : activeGame.phase === "encounter" ? "Encounter" : "Deploy";
  const participant = room && session ? room.participants.find((candidate) => candidate.id === session.participantId) : undefined;
  const canAct = !online || (participant?.role === "player" && participant.playerIndex === activeGame.currentPlayer);

  useEffect(() => {
    const saved = localStorage.getItem("abominations-session");
    if (!saved) return;
    try {
      const stored = JSON.parse(saved) as { token: string; participantId: string; room?: { code: string } };
      if (!stored.token || !stored.room?.code) return;
      void readRoom(stored.room.code, stored.token).then((restoredRoom) => {
        setSession({ token: stored.token, participantId: stored.participantId, room: restoredRoom });
        setRoom(restoredRoom); setRoomCode(restoredRoom.code);
      }).catch(() => localStorage.removeItem("abominations-session"));
    } catch { localStorage.removeItem("abominations-session"); }
  }, []);

  useEffect(() => {
    if (!session || !room) return;
    const socket = new WebSocket(websocketUrl(room.code, session.token));
    let polling: ReturnType<typeof setInterval> | undefined;
    const refresh = () => readRoom(room.code, session.token, room.version).then(setRoom).catch(() => undefined);
    socket.onmessage = (event) => { const message = JSON.parse(event.data) as { type: string; room: RoomView }; if (message.type === "room.updated") setRoom(message.room); };
    socket.onerror = () => { polling = setInterval(refresh, 2000); };
    socket.onclose = () => { if (!polling) polling = setInterval(refresh, 2000); };
    return () => { socket.close(); if (polling) clearInterval(polling); };
  }, [session?.token, room?.code]);

  const runCommand = async (command: Parameters<typeof sendCommand>[2]) => {
    setError("");
    try {
      if (online && session && room) setRoom(await sendCommand(room.code, session.token, command));
      else if (command.type === "move") setGame(moveMonster(game, activePlayer.id, command.destination));
      else setGame(activeGame.phase === "fight" ? resolveFight(activeGame) : activeGame.phase === "encounter" ? resolveEncounter(activeGame) : deployUnit(activeGame));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed"); }
  };

  const startSession = async (kind: "create" | "join" | "spectate") => {
    setError("");
    try {
      const result = kind === "create" ? await createRoom(2) : kind === "join" ? await joinRoom(roomCode, displayName || "Player") : await spectateRoom(roomCode, displayName || "Spectator");
      setSession(result); setRoom(result.room); setRoomCode(result.room.code); localStorage.setItem("abominations-session", JSON.stringify({ token: result.token, participantId: result.participantId, room: { code: result.room.code } }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not join room"); }
  };

  const resetLocal = () => { setSession(null); setRoom(null); setError(""); setGame(createGame(2)); localStorage.removeItem("abominations-session"); };
  const log = useMemo(() => activeGame.log.slice(0, 5), [activeGame.log]);

  return <main>
    <header><div><p className="eyebrow">ABOMINATIONS ATTACK AMERICA · WEB PLAYTEST</p><h1>Take the city. Become the legend.</h1><p className="lede">A digital monster-versus-military strategy game. Local play and online rooms share the same rules engine.</p></div><button className="ghost" onClick={resetLocal}>Local game</button></header>
    <section className="lobby"><div><span className="label">ONLINE ROOM</span><p>{online ? <>Room <strong>{room?.code}</strong> · {participant?.role === "spectator" ? "spectating" : `Player ${(participant?.playerIndex ?? 0) + 1}`}</> : "Play with friends or watch without an account."}</p></div>{!online && <div className="lobby-actions"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" /><input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="Room code" maxLength={6} /><button onClick={() => startSession("create")}>Create</button><button onClick={() => startSession("join")}>Join</button><button className="subtle" onClick={() => startSession("spectate")}>Spectate</button></div>} {error && <p className="error">{error}</p>}</section>
    <section className="status"><div><span className="label">ROUND</span><strong>{activeGame.round}</strong></div><div><span className="label">ACTIVE MONSTER</span><strong>{activePlayer.name}</strong></div><div><span className="label">PHASE</span><strong>{action}</strong></div><div><span className="label">STOMP MARKERS</span><strong>{activeGame.stompMarkers}</strong></div></section>
    <section className="layout"><div className="board-panel"><div className="panel-heading"><div><span className="label">TACTICAL MAP · RULE SPACE RECONSTRUCTION</span><h2>{activeLocation?.name}</h2></div><span className="chip">{online ? `ROOM ${room?.code}` : `PLAYER ${activeGame.currentPlayer + 1}`}</span></div><div className="map"><div className="hex-grid" aria-hidden="true">{boardHexes.map((hex) => <span key={`${hex.row}-${hex.col}`} className={`hex ${hex.water ? "water" : "land"}`} style={{ gridColumn: hex.col + 1, gridRow: hex.row + 1 }} />)}</div><div className="map-copy"><strong>MONSTERS</strong><span>MENACE AMERICA</span></div><div className="region-label west">HOLLYWOOD</div>{locations.map((place) => <button key={place.id} disabled={!canAct || activeGame.phase !== "move"} className={`location ${place.kind} ${place.id === activePlayer.location ? "active" : ""}`} style={{ left: `${place.x}%`, top: `${place.y}%` }} onClick={() => void runCommand({ type: "move", destination: place.id })}><span className="node">{place.kind === "city" ? "✦" : place.kind === "base" ? "⌂" : place.kind === "infamy" ? "★" : place.kind === "mutation" ? "✹" : "⚔"}</span><span>{place.name}</span>{place.kind === "city" && <i className="city-hp">{place.marker}</i>}{activeGame.monsters.filter((m) => m.location === place.id).map((m) => <b key={m.id}>{m.name.slice(0, 1)}</b>)}</button>)}</div><p className="map-note">{canAct ? `Select a linked rule space to move ${activePlayer.name}. City markers show printed HP or dice values; stomp markers are gameplay tokens, not base-map art.` : "Waiting for the active player."}</p></div>
      <aside><div className="card monster-card"><span className="label">MONSTER RECORD</span><h2>{activePlayer.name}</h2><div className="meter"><span style={{ width: `${activePlayer.health / activePlayer.maxHealth * 100}%` }} /></div><div className="stats"><span><b>{activePlayer.health}</b> health</span><span><b>{activePlayer.infamy}</b> infamy</span><span><b>{activePlayer.move}</b> move</span></div></div><div className="card action-card"><span className="label">CURRENT STEP</span><h2>{action}</h2><p>{activeGame.phase === "move" ? `Move up to ${activePlayer.move} spaces. Choose a connected location on the map.` : activeGame.phase === "fight" ? "Resolve battles started by movement." : activeGame.phase === "encounter" ? "Resolve the space your monster ended on." : "Place one military unit, then pass the turn."}</p>{activeGame.phase !== "move" && <button disabled={!canAct} onClick={() => void runCommand({ type: "advance" })}>{activeGame.phase === "deploy" ? "Deploy & pass turn" : `Resolve ${action.toLowerCase()}`}</button>}</div><div className="card log"><span className="label">TURN LOG</span>{log.map((entry, i) => <p key={i}>{entry}</p>)}</div></aside></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
