import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameState, HexKey } from "@abominations/game-engine";
import type { PublicReplayPage, ReplayFrame } from "@abominations/shared";
import { exportPublicReplay, readPublicReplay } from "../api";
import { boardForGame } from "../board-pin";
import { BoardViewport } from "./BoardViewport";
import { HexGrid } from "./HexGrid";
import "../replay-viewer.css";

const PAGE_SIZE = 8;
const emptyHexes = new Set<HexKey>();
const emptyUnits = new Set<string>();
const emptyPath: HexKey[] = [];
const storageKey = (code: string) => `abominations-replay-bookmarks:${code}`;

function readBookmarks(code: string): number[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(code)) ?? "[]");
    return Array.isArray(value) ? value.filter((version) => Number.isInteger(version) && version >= 0).sort((a, b) => a - b) : [];
  } catch {
    return [];
  }
}

function safeFrameState(page: PublicReplayPage | null, version: number): GameState | undefined {
  if (!page?.replayable) return undefined;
  return [page.base, ...page.frames].find((frame) => frame.version === version)?.state;
}

export function ReplayViewer({ code }: { code: string }) {
  const [page, setPage] = useState<PublicReplayPage | null>(null);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [bookmarks, setBookmarks] = useState(() => readBookmarks(code));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState("");
  const [exporting, setExporting] = useState(false);
  const normalizedCode = code.trim().toUpperCase();

  const loadFrom = useCallback(async (fromVersion: number, selectedVersion = fromVersion) => {
    setLoading(true);
    setError("");
    try {
      const result = await readPublicReplay(normalizedCode, fromVersion, PAGE_SIZE);
      setPage(result);
      if (result.replayable) setCurrentVersion(selectedVersion);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Replay could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [normalizedCode]);

  useEffect(() => { void loadFrom(0); }, [loadFrom]);
  useEffect(() => { setBookmarks(readBookmarks(normalizedCode)); }, [normalizedCode]);

  const frames = useMemo(() => page?.replayable ? [page.base, ...page.frames] : [], [page]);
  const state = safeFrameState(page, currentVersion);
  const currentIndex = frames.findIndex((frame) => frame.version === currentVersion);
  const terminalVersion = page?.replayable ? page.terminalVersion : 0;
  const hasNext = page?.replayable && currentVersion < terminalVersion;

  const goPrevious = () => {
    if (!page?.replayable || currentVersion <= 0) return;
    if (currentIndex > 0) setCurrentVersion(frames[currentIndex - 1]!.version);
    else void loadFrom(Math.max(0, currentVersion - PAGE_SIZE), currentVersion - 1);
  };

  const goNext = () => {
    if (!page?.replayable || !hasNext) return;
    if (currentIndex >= 0 && currentIndex < frames.length - 1) setCurrentVersion(frames[currentIndex + 1]!.version);
    else void loadFrom(currentVersion, currentVersion + 1);
  };

  const toggleBookmark = () => {
    const next = bookmarks.includes(currentVersion)
      ? bookmarks.filter((version) => version !== currentVersion)
      : [...bookmarks, currentVersion].sort((a, b) => a - b);
    setBookmarks(next);
    try { localStorage.setItem(storageKey(normalizedCode), JSON.stringify(next)); } catch { /* Bookmarks stay useful for this view if storage is unavailable. */ }
  };

  const goToBookmark = (version: number) => {
    if (frames.some((frame) => frame.version === version)) setCurrentVersion(version);
    else void loadFrom(version, version);
  };

  const copyShareLink = async () => {
    const link = new URL(window.location.pathname, window.location.origin);
    link.searchParams.set("replay", normalizedCode);
    try {
      await navigator.clipboard.writeText(link.toString());
      setSharing("Public replay link copied.");
    } catch {
      setSharing("Clipboard access is unavailable in this browser.");
    }
  };

  const downloadExport = async () => {
    setExporting(true);
    setError("");
    try {
      const replay = await exportPublicReplay(normalizedCode);
      if (!replay.replayable) throw new Error(replay.reason === "export-too-large" ? "This match is too large for a single JSON export." : "This replay cannot be exported.");
      const blob = new Blob([JSON.stringify(replay, null, 2)], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `abominations-replay-${normalizedCode}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Replay export failed.");
    } finally {
      setExporting(false);
    }
  };

  const board = state ? boardForGame(state) : undefined;
  const currentFrame: ReplayFrame | undefined = frames.find((frame) => frame.version === currentVersion);

  return <main className="replay-shell">
    <header className="replay-header">
      <div><span className="label">PUBLIC MATCH REPLAY</span><h1>Room {normalizedCode}</h1></div>
      {page?.replayable && <p>Board {page.boardId} · v{page.boardVersion} · rules {page.rulesetVersion}</p>}
    </header>
    {loading && <p className="replay-notice" role="status">Loading replay…</p>}
    {error && <p className="replay-notice replay-error" role="alert">{error}</p>}
    {!loading && page && !page.replayable && <section className="replay-notice" role="status">
      <h2>Replay unavailable</h2>
      <p>{page.reason === "not-found" ? "This match is not public or does not exist." : page.reason === "not-completed" ? "Only completed public matches can be replayed." : page.reason === "history-incomplete" ? "This match does not have a complete replay history." : "This match history exceeds the supported replay format or limits."}</p>
    </section>}
    {state && currentFrame && page?.replayable && <>
      <nav className="replay-controls" aria-label="Replay navigation">
        <button type="button" onClick={goPrevious} disabled={currentVersion === 0 || loading}>Previous</button>
        <div className="replay-position" aria-live="polite"><strong>Version {currentVersion}</strong><span>{currentFrame.eventType.replaceAll(".", " · ")}</span></div>
        <button type="button" onClick={goNext} disabled={!hasNext || loading}>Next</button>
        <button type="button" className={bookmarks.includes(currentVersion) ? "is-bookmarked" : ""} onClick={toggleBookmark} aria-pressed={bookmarks.includes(currentVersion)}>
          {bookmarks.includes(currentVersion) ? "Remove bookmark" : "Bookmark this moment"}
        </button>
        {bookmarks.length > 0 && <label className="replay-bookmarks">Saved moments
          <select value="" onChange={(event) => { const version = Number(event.target.value); if (Number.isInteger(version)) goToBookmark(version); }}>
            <option value="" disabled>Jump to bookmark</option>
            {bookmarks.map((version) => <option key={version} value={version}>Version {version}</option>)}
          </select>
        </label>}
        <button type="button" onClick={() => void copyShareLink()} disabled={loading}>Copy replay link</button>
        <button type="button" onClick={() => void downloadExport()} disabled={loading || exporting}>{exporting ? "Preparing JSON…" : "Download JSON"}</button>
      </nav>
      {sharing && <p className="replay-share-status" role="status">{sharing}</p>}
      <section className="replay-board-panel" aria-label="Read-only replay board">
        <div className="replay-board-heading"><span className="label">READ-ONLY BOARD</span><strong>Round {state.round} · Player {state.currentPlayer + 1} · {state.phase}</strong></div>
        {!board && <p role="alert">The board version for this replay is unavailable.</p>}
        {board && <BoardViewport board={board} boardId={state.boardId} boardContentHash={state.boardContentHash}>
          <HexGrid
            game={state}
            retreatDestinations={emptyHexes}
            onRetreat={() => undefined}
            deploymentDestinations={emptyHexes}
            onDeploy={() => undefined}
            onSelectMonster={() => undefined}
            activePlayerId={state.monsters[state.currentPlayer]?.id ?? ""}
            canAct={false}
            legalDestinations={emptyHexes}
            legalUnitDestinations={emptyHexes}
            selectableUnitIds={emptyUnits}
            selectedUnitId={null}
            selectedPath={emptyPath}
            hoveredPath={emptyPath}
            selectedUnitPath={emptyPath}
            acceptedPath={emptyPath}
            onSelectUnit={() => undefined}
            onFocusHex={() => undefined}
            onSelectStack={() => undefined}
            onChoosePath={() => undefined}
            onChooseUnitPath={() => undefined}
            onPreviewPath={() => undefined}
            onClearPreview={() => undefined}
          />
        </BoardViewport>}
      </section>
    </>}
  </main>;
}
