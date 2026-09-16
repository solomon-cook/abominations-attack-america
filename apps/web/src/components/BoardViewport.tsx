import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import type { BoardDefinition } from "@abominations/game-engine";
import { AUDITED_BOARD_WORLD, buildDisplayHexLayout } from "../board-layout";
import { cameraScale, cameraView, clampCamera, panCamera, resetCamera, zoomCamera, type BoardCamera, type Point, type Size } from "../board-camera";

type Props = { board?: BoardDefinition; boardId: string; boardContentHash: string; children: ReactNode; overviewImage?: string };
const INITIAL_VIEWPORT = { width: 1000, height: 700 };

/** One camera owns terrain, pieces, paths and hit targets. HUD stays outside it. */
export function BoardViewport({ board, boardId, boardContentHash, children, overviewImage }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>(INITIAL_VIEWPORT);
  const world = AUDITED_BOARD_WORLD;
  const [camera, setCamera] = useState<BoardCamera>(() => resetCamera(INITIAL_VIEWPORT, world));
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; previous: Point; distance: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const cells = useMemo(() => board ? buildDisplayHexLayout(board) : [], [board]);
  const view = cameraView(camera, viewport, world);
  const scale = cameraScale(camera, viewport, world);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("board-camera-change", { detail: { tilePixels: world.width / 18.25 * scale } }));
  }, [scale, world]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) };
      setViewport(next);
      setCamera((current) => clampCamera(current, next, world));
    });
    observer.observe(map);
    return () => observer.disconnect();
  }, [world]);

  useEffect(() => {
    const screen = mapRef.current?.closest<HTMLElement>(".game-screen");
    const dock = screen?.querySelector<HTMLElement>(".board-action-bar");
    if (!screen || !dock) return;
    const observer = new ResizeObserver(() => {
      screen.style.setProperty("--action-dock-height", `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    });
    observer.observe(dock);
    return () => { observer.disconnect(); screen.style.removeProperty("--action-dock-height"); };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = map.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
      setCamera((current) => zoomCamera(current, current.zoom * Math.exp(-delta * .0015), { x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport, world));
    };
    map.addEventListener("wheel", wheel, { passive: false });
    return () => map.removeEventListener("wheel", wheel);
  }, [viewport, world]);

  const localPoint = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pointerMetrics = () => {
    const points = [...pointers.current.values()];
    const first = points[0]!;
    const second = points[1];
    return second ? { midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: Math.hypot(first.x - second.x, first.y - second.y) }
      : { midpoint: first, distance: 0 };
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!pointers.current.size) suppressClick.current = false;
    pointers.current.set(event.pointerId, localPoint(event));
    const { midpoint, distance } = pointerMetrics();
    gesture.current = { start: midpoint, previous: midpoint, distance, dragged: pointers.current.size > 1 };
    if (pointers.current.size > 1) suppressClick.current = true;
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, localPoint(event));
    const { midpoint, distance } = pointerMetrics();
    const currentGesture = gesture.current;
    if (!currentGesture.dragged && Math.hypot(midpoint.x - currentGesture.start.x, midpoint.y - currentGesture.start.y) < 6) return;
    currentGesture.dragged = true;
    suppressClick.current = true;
    setDragging(true);
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    const previous = currentGesture.previous;
    const previousDistance = currentGesture.distance;
    setCamera((current) => {
      const zoomed = distance && previousDistance ? zoomCamera(current, current.zoom * distance / previousDistance, previous, viewport, world) : current;
      return panCamera(zoomed, { x: midpoint.x - previous.x, y: midpoint.y - previous.y }, viewport, world);
    });
    currentGesture.previous = midpoint;
    currentGesture.distance = distance;
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size) {
      const { midpoint, distance } = pointerMetrics();
      gesture.current = { start: midpoint, previous: midpoint, distance, dragged: true };
    } else { gesture.current = null; setDragging(false); }
  };
  const zoom = (factor: number) => setCamera((current) => zoomCamera(current, current.zoom * factor, { x: viewport.width / 2, y: viewport.height / 2 }, viewport, world));
  const pan = (x: number, y: number) => setCamera((current) => panCamera(current, { x: x * viewport.width, y: y * viewport.height }, viewport, world));

  return <>
    <div ref={mapRef} className={`map board-viewport${dragging ? " is-dragging" : ""}`} role="group" aria-label="Board coordinate shell" aria-describedby="board-description"
      data-board-id={boardId} data-board-content-hash={boardContentHash} data-rendered-board-id={board?.id ?? "unavailable"} data-rendered-board-content-hash={board?.contentHash ?? "unavailable"}
      data-camera-zoom={camera.zoom.toFixed(3)} data-camera-scale={scale} data-world-width={world.width} data-world-height={world.height}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
      onClickCapture={(event) => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } }}
      onDragStart={(event) => event.preventDefault()}
      onFocusCapture={(event) => {
        const element = (event.target as HTMLElement).closest<HTMLElement>("[data-hex-key]");
        if (!element || !element.matches(":focus-visible")) return;
        const mapBounds = event.currentTarget.getBoundingClientRect();
        const tile = element.getBoundingClientRect();
        const margin = Math.min(96, viewport.width / 5, viewport.height / 5);
        const x = tile.left < mapBounds.left + margin ? mapBounds.left + margin - tile.left : tile.right > mapBounds.right - margin ? mapBounds.right - margin - tile.right : 0;
        const y = tile.top < mapBounds.top + margin ? mapBounds.top + margin - tile.top : tile.bottom > mapBounds.bottom - margin ? mapBounds.bottom - margin - tile.bottom : 0;
        if (x || y) setCamera((current) => panCamera(current, { x, y }, viewport, world));
      }}>
      <div className="map-canvas" style={{ width: world.width, height: world.height, transform: `translate(${viewport.width / 2 - camera.center.x * scale}px, ${viewport.height / 2 - camera.center.y * scale}px) scale(${scale})` }}>{children}</div>
    </div>
    <div className="map-controls" aria-label="Board view controls">
      <button type="button" aria-label="Pan board left" onClick={() => pan(.12, 0)}>←</button>
      <button type="button" aria-label="Pan board up" onClick={() => pan(0, .12)}>↑</button>
      <button type="button" aria-label="Pan board down" onClick={() => pan(0, -.12)}>↓</button>
      <button type="button" aria-label="Pan board right" onClick={() => pan(-.12, 0)}>→</button>
      <button type="button" aria-label="Zoom board out" disabled={camera.zoom <= 1} onClick={() => zoom(1 / 1.25)}>−</button>
      <span className="map-zoom" aria-live="polite">{Math.round(camera.zoom * 100)}%</span>
      <button type="button" aria-label="Zoom board in" disabled={camera.zoom >= 4} onClick={() => zoom(1.25)}>+</button>
      <button type="button" className="map-reset" onClick={() => setCamera(resetCamera(viewport, world))}>Reset view</button>
      <span className="map-camera-mode">{camera.zoom >= 1.25 ? "Tactical detail" : "Strategic overview"}</span>
    </div>
    <div className="board-minimap">
      <span>CONTINENT OVERVIEW</span>
      <button type="button" aria-label="Board overview. Click to move camera; arrow keys pan." onClick={(event) => {
        if (event.detail === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setCamera((current) => clampCamera({ ...current, center: { x: (event.clientX - rect.left) / rect.width * world.width, y: (event.clientY - rect.top) / rect.height * world.height } }, viewport, world));
      }} onKeyDown={(event) => {
        const direction = { ArrowLeft: [.12, 0], ArrowRight: [-.12, 0], ArrowUp: [0, .12], ArrowDown: [0, -.12] }[event.key];
        if (direction) { event.preventDefault(); pan(direction[0], direction[1]); }
      }}>
        <svg viewBox={`0 0 ${world.width} ${world.height}`} aria-hidden="true">
          <rect width={world.width} height={world.height} fill="#287382" />
          {overviewImage ? <image href={overviewImage} width={world.width} height={world.height} preserveAspectRatio="none" /> : cells.map(({ hex, left, top }) => <circle key={hex.key} cx={left * world.width / 100} cy={top * world.height / 100} r={25} fill={hex.waterClass === "land" ? "#87905b" : hex.waterClass === "sea" ? "#287382" : "#4c929b"} />)}
          <rect className="minimap-view" x={view.x} y={view.y} width={view.width} height={view.height} />
        </svg>
      </button>
    </div>
  </>;
}
