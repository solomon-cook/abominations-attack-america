import { memo, useEffect, useRef, useState } from "react";
import { type BoardDefinition, type BoardHex, type HexKey } from "@abominations/game-engine";
import { buildDisplayHexLayout, AUDITED_TILE_WIDTH_PERCENT, AUDITED_BOARD_ASPECT_RATIO } from "../board-layout";
import manifest from "../board-art-manifest.json";

type CellArt = { cellId: string; asset: string; unique: boolean; src: string };
const artByKey: Readonly<Record<string, CellArt>> = manifest.cells;
export function cellArt(key: HexKey) { return artByKey[key]; }

/** Subscribe once for all cells; transforms do not trigger ResizeObserver. */
let requestedSize = 256;
const subscribers = new Set<(size: number) => void>();
function onCamera(event: Event) {
  // Keep extra source samples for fine lettering and angled hex edges.
  const pixels = (event as CustomEvent<{ tilePixels: number }>).detail.tilePixels * (window.devicePixelRatio || 1) * 2;
  const size = pixels > 512 ? 1024 : pixels > 256 ? 512 : 256;
  if (size === requestedSize) return;
  requestedSize = size;
  subscribers.forEach((update) => update(size));
}

export const TerrainArt = memo(function TerrainArt({ hex }: { hex: BoardHex }) {
  const art = artByKey[hex.key];
  const image = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState(requestedSize);
  const [nearby, setNearby] = useState(false);
  useEffect(() => {
    if (!subscribers.size) window.addEventListener("board-camera-change", onCamera);
    subscribers.add(setSize);
    setSize(requestedSize);
    return () => {
      subscribers.delete(setSize);
      if (!subscribers.size) window.removeEventListener("board-camera-change", onCamera);
    };
  }, []);
  useEffect(() => {
    const element = image.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!art) return null;
  return <img ref={image} className="tile-base audited-terrain" data-art-cell={art.cellId}
    src={`/assets/board/audited/${nearby ? size : 256}/${art.asset}.webp`}
    alt="" aria-hidden="true" draggable={false} decoding="async" loading="lazy" />;
});

// Preserve the existing integration point for board rendering.
export { FeatureMarkers } from "./BoardFeatureOverlays";

/** A single crisp grid/barrier overlay prevents doubled tile borders. */
export const BoardGridLines = memo(function BoardGridLines({ board }: { board: BoardDefinition }) {
  const cells = buildDisplayHexLayout(board);
  const display = new Map(cells.map(c => [c.hex.key, c]));
  const w = AUDITED_TILE_WIDTH_PERCENT;
  const h = w * Math.sqrt(3) / 2 * AUDITED_BOARD_ASPECT_RATIO;
  const polygon = (x: number, y: number) => [[x-w/4,y-h/2],[x+w/4,y-h/2],[x+w/2,y],[x+w/4,y+h/2],[x-w/4,y+h/2],[x-w/2,y]];
  return <svg className="audited-grid-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <g className="terrain-grid">{cells.map(c => <polygon key={c.hex.key} points={polygon(c.left,c.top).map(p=>p.join(",")).join(" ")} />)}</g>
    <g className="terrain-barriers">{board.edges.filter(e => e.from < e.to && e.barrier !== "none").map(edge => {
      const from = display.get(edge.from), to = display.get(edge.to);
      if (!from || !to) return null;
      const points = polygon(from.left,from.top), other = polygon(to.left,to.top);
      const shared = points.filter(p => other.some(q => Math.hypot(p[0]-q[0],p[1]-q[1]) < .001));
      if (shared.length !== 2) return null;
      return <line key={`${edge.from}:${edge.to}`} className={`barrier-${edge.barrier}`} x1={shared[0][0]} y1={shared[0][1]} x2={shared[1][0]} y2={shared[1][1]} />;
    })}</g>
  </svg>;
});
