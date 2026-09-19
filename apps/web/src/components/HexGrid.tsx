import {
  buildBoardIndex,
  FULL_HONEYCOMB_BOARD,
  AUDITED_BOARD,
  PROVISIONAL_AUTHORITATIVE_BOARD,
  locationIdToHexKey,
  isHexKey,
  locations,
  type GameState,
  type HexKey,
  type BoardHex,
  type BoardDefinition,
} from "@abominations/game-engine";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mutationArt } from "./MutationStrip";
import { cardDefinition } from "@abominations/game-engine";
import { buildDisplayHexLayout, AUDITED_TILE_WIDTH_PERCENT } from "../board-layout";
import { boardForGame } from "../board-pin";
import { TerrainArt, FeatureMarkers, BoardGridLines } from "./BoardTerrain";
import { StompedMarker } from "./BoardFeatureOverlays";
import { monsterAssetSlug } from "../monster-assets";
import "../board-pieces.css";

function displayHexesForBoard(board: BoardDefinition | undefined) {
  if (!board) return [];
  if (board.id === AUDITED_BOARD.id || board.id === FULL_HONEYCOMB_BOARD.id || board.id === PROVISIONAL_AUTHORITATIVE_BOARD.id) {
    return buildDisplayHexLayout(board).map(({ hex, left, top }) => ({
      hex,
      // The candidate shell must not inherit the development fixture's named
      // locations or artwork. Those overlays are only authoritative for the
      // explicitly pinned development board until the physical cells are reviewed.
      place: undefined,
      left,
      top,
      developmentFixture: false,
    }));
  }
  const developmentPlaces = new Map(locations.map((place) => [locationIdToHexKey(place.id), place]));
  const developmentHexes = new Map(Object.values(board.hexes).map((hex) => [hex.key, hex]));
  const candidateLayout = buildDisplayHexLayout(FULL_HONEYCOMB_BOARD);
  const candidateKeys = new Set(candidateLayout.map(({ hex }) => hex.key));
  const shell = candidateLayout.map(({ hex: candidateHex, left, top }) => {
    const developmentHex = developmentHexes.get(candidateHex.key);
    return {
      // The candidate shell is presentation-only here. Only the nine named
      // development hexes below remain enabled by the actual board selectors.
      hex: developmentHex ?? candidateHex,
      place: developmentPlaces.get(candidateHex.key),
      left,
      top,
      developmentFixture: Boolean(developmentHex),
    };
  });
  const outlyingDevelopmentHexes = [...developmentHexes.values()]
    .filter((hex) => !candidateKeys.has(hex.key))
    .map((hex) => {
      const place = developmentPlaces.get(hex.key);
      return { hex, place, left: place?.x ?? 50, top: place?.y ?? 50, developmentFixture: true };
    });
  return [...shell, ...outlyingDevelopmentHexes];
}

function boardArtForHex(hex: BoardHex, place?: (typeof locations)[number]) {
  if (place?.kind === "city" || hex.features.some((feature) => feature.kind === "city")) return "/assets/board/coastal-city/small/coastal_city_0deg.webp";
  const feature = hex.features[0]?.kind;
  const featureAssets: Record<string, string> = {
    "military-base": "/assets/board/features/military_base.webp",
    "infamy-site": "/assets/board/features/infamy_site.webp",
    "mutation-site": "/assets/board/features/mutation_site.webp",
    "challenge-site": "/assets/board/features/challenge_site.webp",
    lair: "/assets/board/features/lair.webp",
    "los-angeles": "/assets/board/features/los_angeles.webp",
  };
  return featureAssets[feature ?? ""];
}

function provisionalFeatureLabel(hex: BoardHex): string | undefined {
  const feature = hex.features.find((candidate) => candidate.kind !== "city");
  switch (feature?.kind) {
    case "military-base": return "BASE";
    case "infamy-site": return "INFAMY";
    case "mutation-site": return "MUTATION";
    case "challenge-site": return "CHALLENGE";
    case "los-angeles": return "LOS ANGELES";
    default: return undefined;
  }
}

function unitArtForType(unitTypeId?: string) {
  return unitTypeId ? `/assets/military/${unitTypeId === "navy-nuclear-submarine-missile" ? "navy-launched-cruise-missile" : unitTypeId}.webp` : undefined;
}

function monsterArtForName(name: string) {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  // Board figures for these two monsters are named opposite to their portraits.
  const boardAssetSlug = slug === "tomanagi" ? "gargantis-light" : slug === "gargantis" ? "tomanagi-dark" : monsterAssetSlug(slug);
  return ["gargantis", "konk", "megaclaw", "tomanagi", "toxicor", "zorb"].includes(slug)
    ? `/assets/monsters/${boardAssetSlug}.webp`
    : undefined;
}

type Props = {
  setupLocations?: ReadonlyMap<HexKey, string>;
  onSetupLocation?: (key: HexKey) => void;
  retreatDestinations: ReadonlySet<HexKey>;
  onRetreat: (destination: HexKey) => void;
  deploymentDestinations: ReadonlySet<HexKey>;
  onDeploy: (destination: HexKey) => void;
  onSelectMonster: () => void;
  game: GameState;
  activePlayerId: string;
  canAct: boolean;
  legalDestinations: ReadonlySet<HexKey>;
  legalUnitDestinations: ReadonlySet<HexKey>;
  selectableUnitIds: ReadonlySet<string>;
  selectedUnitId: string | null;
  selectedPath: readonly HexKey[];
  hoveredPath: readonly HexKey[];
  selectedUnitPath: readonly HexKey[];
  acceptedPath: readonly HexKey[];
  acceptedPieceId?: string;
  acceptedAnimationKey?: number;
  focusedHexKey?: HexKey | null;
  onSelectUnit: (unitId: string) => void;
  onFocusHex: (hexKey: HexKey) => void;
  onSelectStack: (hexKey: HexKey) => void;
  onChoosePath: (destination: HexKey) => void;
  onChooseUnitPath: (destination: HexKey) => void;
  onPreviewPath: (destination: HexKey) => void;
  onClearPreview: () => void;
};

export function HexGrid({ setupLocations, onSetupLocation, retreatDestinations, onRetreat, deploymentDestinations, onDeploy, onSelectMonster, game, activePlayerId, canAct, legalDestinations, legalUnitDestinations, selectableUnitIds, selectedUnitId, selectedPath, hoveredPath, selectedUnitPath, acceptedPath, acceptedPieceId, acceptedAnimationKey, focusedHexKey, onSelectUnit, onFocusHex, onSelectStack, onChoosePath, onChooseUnitPath, onPreviewPath, onClearPreview }: Props) {
  const [monsterPeek, setMonsterPeek] = useState<{id:string;x:number;y:number} | null>(null);
  const peekMonster = game.monsters.find(monster => monster.id === monsterPeek?.id);
  const peekCards = peekMonster ? (game.players[game.monsters.indexOf(peekMonster)]?.mutationCardIds ?? []).filter(id=>cardDefinition(id)) : [];
  const board = boardForGame(game);
  const audited = board?.id === AUDITED_BOARD.id;
  const boardHexes = useMemo(() => displayHexesForBoard(board), [board]);
  const gridRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const boardIndex = useMemo(() => board ? buildBoardIndex(board) : undefined, [board]);
  const activeNeighbours = new Set(board && isHexKey(game.monsters.find((monster) => monster.id === activePlayerId)?.location ?? "")
    ? boardIndex?.neighbours[game.monsters.find((monster) => monster.id === activePlayerId)!.location as HexKey] ?? []
    : []);
  const displayByKey = useMemo(() => new Map(boardHexes.map(({ hex, left, top }) => [hex.key, { left, top }])), [boardHexes]);
  const occupants = useMemo(() => {
    const monsters = new Map<string, GameState["monsters"]>();
    const units = new Map<string, GameState["units"]>();
    for (const monster of game.monsters) {
      const group = monsters.get(monster.location) ?? [];
      group.push(monster);
      monsters.set(monster.location, group);
    }
    for (const unit of game.units) {
      const group = units.get(unit.location) ?? [];
      group.push(unit);
      units.set(unit.location, group);
    }
    return { monsters, units };
  }, [game.monsters, game.units]);
  const activePlayer = game.monsters.find((monster) => monster.id === activePlayerId);
  const selectedDisplayPath = selectedUnitId ? selectedUnitPath : selectedPath;
  const path = selectedDisplayPath.length > 1 ? selectedDisplayPath : hoveredPath;
  const pathPoints = path
    .map((key) => displayByKey.get(key))
    .filter((point): point is { left: number; top: number } => Boolean(point))
    .map(({ left, top }) => `${left},${top}`)
    .join(" ");
  const acceptedPathPoints = acceptedPath
    .map((key) => displayByKey.get(key))
    .filter((point): point is { left: number; top: number } => Boolean(point))
    .map(({ left, top }) => `${left},${top}`)
    .join(" ");
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !acceptedAnimationKey || acceptedPath.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const destination = grid.querySelector<HTMLElement>(".accepted-arrival");
    const points = acceptedPath.map(key => displayByKey.get(key));
    if (!destination || points.some(point => !point)) return;
    const unit = game.units.find(candidate => candidate.id === acceptedPieceId);
    const directional = Boolean(unit?.unitTypeId?.includes("fighter"));
    // Animate above the tiles so their hexagonal clipping never cuts off a piece.
    const traveller = destination.cloneNode(true) as HTMLElement;
    traveller.className = "travelling-piece";
    traveller.setAttribute("aria-hidden", "true");
    const width = destination.offsetWidth;
    const height = destination.offsetHeight;
    Object.assign(traveller.style, { position: "absolute", width: `${width}px`, height: `${height}px`, margin: "0", pointerEvents: "none", zIndex: "20", objectFit: "contain" });
    grid.appendChild(traveller);
    destination.style.visibility = "hidden";
    const coordinates = points.map(point => ({ x: point!.left * grid.clientWidth / 100, y: point!.top * grid.clientHeight / 100 }));
    // The final stack slot can be off-centre; settle into its actual position.
    let endX = width / 2;
    let endY = height / 2;
    for (let element: HTMLElement | null = destination; element && element !== grid; element = element.offsetParent as HTMLElement | null) {
      endX += element.offsetLeft;
      endY += element.offsetTop;
      if (element.classList.contains("hex-tile")) {
        endX -= element.offsetWidth / 2;
        endY -= element.offsetHeight / 2;
      }
    }
    const frames: Keyframe[] = [];
    let angle = 0;
    const transform = (x: number, y: number, rotation: number) => `translate(${x - width / 2}px, ${y - height / 2}px) rotate(${rotation}deg)`;
    coordinates.slice(0, -1).forEach((point, index) => {
      const next = coordinates[index + 1];
      const heading = directional ? Math.atan2(next.y - point.y, next.x - point.x) * 180 / Math.PI + 90 : 0;
      angle += ((heading - angle + 540) % 360) - 180;
      frames.push({ offset: index / (coordinates.length - 1) * .9, transform: transform(point.x, point.y, angle) });
      frames.push({ offset: (index + 1) / (coordinates.length - 1) * .9, transform: transform(next.x, next.y, angle) });
    });
    const restingAngle = angle + ((-angle % 360 + 540) % 360) - 180;
    frames.push({ offset: 1, transform: transform(endX, endY, restingAngle) });
    traveller.style.left = "0";
    traveller.style.top = "0";
    const animation = traveller.animate(frames, { duration: (acceptedPath.length - 1) * 400 + 200, easing: "linear", fill: "forwards" });
    const finish = () => { traveller.remove(); destination.style.visibility = ""; };
    animation.onfinish = finish;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopForReducedMotion = () => { if (reducedMotion.matches) { animation.cancel(); finish(); } };
    reducedMotion.addEventListener("change", stopForReducedMotion);
    return () => { animation.cancel(); finish(); reducedMotion.removeEventListener("change", stopForReducedMotion); };
  }, [acceptedAnimationKey, acceptedPath, acceptedPieceId, displayByKey]);
  return (
    <div ref={gridRef} className={`hex-grid ${audited ? "audited-grid" : ""}`}>
      {audited && <BoardGridLines board={board} />}
      {!board && <div className="board-unavailable" role="alert">This match references an unavailable board version. The board is hidden until the matching board definition is loaded.</div>}
      {pathPoints && path.length > 1 && (
        <svg className="path-preview" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="path-arrowhead" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L5,2.5 L0,5 Z" />
            </marker>
          </defs>
          <polyline points={pathPoints} markerEnd="url(#path-arrowhead)" />
        </svg>
      )}
      {acceptedAnimationKey && acceptedPathPoints && acceptedPath.length > 1 && (
        <svg className="accepted-path" key={acceptedAnimationKey} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={acceptedPathPoints} />
        </svg>
      )}
      {boardHexes.map(({ hex, place, left, top, developmentFixture }) => {
        const placeKey = hex.key;
        const monstersHere = occupants.monsters.get(placeKey) ?? [];
        const unitsHere = occupants.units.get(placeKey) ?? [];
        const setupLegal = setupLocations?.has(placeKey) ?? false;
        const retreatLegal = canAct && game.phase === "fight" && retreatDestinations.has(placeKey);
        const deploymentLegal = setupLegal || canAct && game.phase === "deploy" && deploymentDestinations.has(placeKey);
        const monsterLegal = canAct && game.phase === "move" && legalDestinations.has(placeKey);
        const unitLegal = canAct && game.phase === "move" && legalUnitDestinations.has(placeKey);
        const inspectableUnit = unitsHere[0];
        const selectableUnit = canAct ? unitsHere.find((unit) => selectableUnitIds.has(unit.id)) : undefined;
        const featureText = hex.features.map((feature) => feature.kind).join(", ");
        const neighbourText = (boardIndex?.neighbours[placeKey] ?? [])
          .map((neighbourKey) => board?.hexes[neighbourKey]?.label ?? neighbourKey)
          .join(", ");
        const occupantText = [
          ...monstersHere.map((monster) => monster.name),
          ...unitsHere.map((unit) => `${unit.branch} unit`),
        ].join(", ");
        const displayName = setupLocations?.get(placeKey) ?? place?.name ?? hex.label ?? (audited ? `${hex.waterClass} cell ${hex.audit?.row}/${hex.audit?.column}` : `Unresolved ${hex.key}`);
        const provisionalFeatureName = (audited || board?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id) && hex.features.some((feature) => feature.kind === "city")
          ? hex.label
          : undefined;
        const provisionalFeatureText = board?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id ? provisionalFeatureLabel(hex) : undefined;
        const visibleName = setupLocations?.get(placeKey) ?? place?.name ?? (developmentFixture ? hex.label : provisionalFeatureName ?? "");
        const locationMeta = place?.kind === "city"
          ? `city, ${place.marker ?? "benefit not recorded"}`
          : place?.kind === "mutation"
            ? "Mutation space"
            : undefined;
        const interactionHint = monsterLegal || unitLegal
          ? "Legal destination"
          : selectableUnit
            ? `Select ${selectableUnit.branch} unit`
            : "Not currently reachable";
        const selectedPathCost = path.includes(placeKey) ? path.indexOf(placeKey) : undefined;
        const combatStrength = [
          ...unitsHere.map((unit) => `${unit.branch} ${unit.attacks} attack${unit.attacks === 1 ? "" : "s"}/${unit.damage} damage/${unit.defense} Defense`),
          ...monstersHere.map((monster) => `${monster.name} ${monster.health}/${monster.maxHealth} Health/${monster.infamy} Infamy`),
        ].join(", ");
        const tooltipText = [
          `${displayName || `Hex ${hex.key}`} · ${hex.key}`,
          `${hex.waterClass} water class`,
          featureText || "No recorded feature",
          neighbourText ? `Neighbours: ${neighbourText}` : "No recorded neighbours",
          occupantText ? `Occupants: ${occupantText}` : "Unoccupied",
          selectedPathCost !== undefined && selectedPathCost > 0 ? `Movement cost: ${selectedPathCost}` : "Movement cost: not recorded for this hex",
          combatStrength ? `Combat strength: ${combatStrength}` : "Combat strength: no occupant recorded",
          hex.verification !== "verified" ? "Physical details unavailable" : interactionHint,
        ].join(" · ");
        const baseArt = hex.waterClass === "unresolved"
          ? undefined
          : hex.waterClass === "land"
            ? "/assets/board/grassland.webp"
            : "/assets/board/coast/coast_0deg.webp";
        const boardArt = audited ? undefined : boardArtForHex(hex, place);
        const stomped = game.stompedLocations.includes(placeKey);
        const occupantCount = monstersHere.length + unitsHere.length;
        const provisionalBoard = audited || board?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id;
        const actionUnavailable = !deploymentLegal && !retreatLegal && !inspectableUnit && (!canAct || game.phase !== "move" || (!monsterLegal && !unitLegal && !selectableUnit));
        const moveFocus = (direction: "left" | "right" | "up" | "down") => {
          if (!provisionalBoard) return;
          const origin = displayByKey.get(placeKey);
          if (!origin) return;
          const neighbours = (boardIndex?.neighbours[placeKey] ?? [])
            .map((key) => ({ key, point: displayByKey.get(key) }))
            .filter((candidate): candidate is { key: HexKey; point: { left: number; top: number } } => Boolean(candidate.point));
          const directionVector = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[direction];
          const ordered = neighbours
            .map((candidate) => {
              const dx = candidate.point.left - origin.left;
              const dy = candidate.point.top - origin.top;
              const forward = dx * directionVector[0] + dy * directionVector[1];
              return { ...candidate, forward, distance: Math.abs(dx) + Math.abs(dy) };
            })
            .filter((candidate) => candidate.forward > 0)
            .sort((a, b) => b.forward - a.forward || a.distance - b.distance);
          const next = ordered[0];
          if (!next) return;
          onFocusHex(next.key);
          buttonRefs.current[next.key]?.focus({ preventScroll: true });
        };
        return (
          <button
            key={hex.key}
            aria-label={`${displayName}${stomped ? ", stomped" : ""}${locationMeta ? `, ${locationMeta}` : ""}, hex ${hex.key}, neighbours ${neighbourText || "none recorded"}, ${featureText || "no recorded feature"}${occupantText ? `, occupied by ${occupantText}` : ", unoccupied"}, ${setupLegal ? "choose starting location" : deploymentLegal ? "legal deployment location" : selectableUnit ? `select ${selectableUnit.branch} unit` : monsterLegal || unitLegal ? "legal destination" : "not currently reachable"}`}
            data-hex-key={hex.key}
            data-location-name={place?.name ?? hex.label}
            data-audit-cell={hex.audit ? `${hex.audit.row}/${hex.audit.column}` : undefined}
            data-stack-count={occupantCount || undefined}
            title={tooltipText}
            aria-disabled={actionUnavailable || (!place && !provisionalBoard) ? true : undefined}
            disabled={(!place && !provisionalBoard) || (!provisionalBoard && actionUnavailable)}
            tabIndex={provisionalBoard ? (placeKey === (focusedHexKey ?? (isHexKey(activePlayer?.location ?? "") ? activePlayer?.location : undefined)) ? 0 : -1) : undefined}
            data-stomped={stomped || undefined}
            data-occupied={occupantCount > 0 || undefined}
            className={`hex-tile ${place?.kind ?? (audited ? "audited-tile" : "unresolved")} ${hex.waterClass === "land" || hex.waterClass === "lakeshore" ? "land" : "water"} ${developmentFixture ? "development-fixture" : ""} ${placeKey === activePlayer?.location ? "active" : ""} ${activeNeighbours.has(placeKey) ? "adjacent" : ""} ${deploymentLegal ? "deployment-legal" : ""} ${retreatLegal ? "retreat-legal" : ""} ${deploymentLegal || retreatLegal || monsterLegal || unitLegal ? "legal" : selectableUnit ? "selectable" : "unreachable"} ${path.at(-1) === placeKey ? "selected" : ""} ${path.includes(placeKey) ? "path-selected" : ""}`}
            style={{ left: `${left}%`, top: `${top}%`, ...(audited ? { width: `${AUDITED_TILE_WIDTH_PERCENT}%` } : {}) }}
            ref={(node) => { buttonRefs.current[placeKey] = node; }}
            onFocus={() => onFocusHex(placeKey)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(event.key.slice(5).toLowerCase() as "left" | "right" | "up" | "down");
              }
            }}
            onMouseEnter={(event) => { if(monsterLegal || unitLegal) onPreviewPath(placeKey); const monster=game.monsters.find(m=>m.location===placeKey); if(monster) {const r=event.currentTarget.getBoundingClientRect();setMonsterPeek({id:monster.id,x:r.left+r.width/2,y:r.top});} }}
            onMouseLeave={() => {onClearPreview();setMonsterPeek(null);}}
            onClick={(event) => {
              if (setupLegal) { onSetupLocation?.(placeKey); return; }
              if (retreatLegal) { onRetreat(placeKey); return; }
              if (deploymentLegal) { onDeploy(placeKey); return; }
              if (game.phase === "move" && event.shiftKey && occupantCount > 0) onSelectStack(placeKey);
              else if (game.phase === "move" && selectableUnit && !selectedUnitId && selectedPath.length < 2) onSelectUnit(selectableUnit.id);
              else if (monsterLegal || unitLegal) {
                if (selectedUnitId) onChooseUnitPath(placeKey);
                else onChoosePath(placeKey);
              } else if (game.phase === "move" && inspectableUnit && !selectedUnitId) onSelectUnit(inspectableUnit.id);
              else if (game.phase !== "deploy" && occupantCount > 0) onSelectStack(placeKey);
              else onFocusHex(placeKey);
            }}
          >
            {audited && (
              <svg className="hex-highlight" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                {/* Inset the stroke so all six edges stay inside the tile's clip. */}
                <polygon points="26.5,3 73.5,3 97,50 73.5,97 26.5,97 3,50" />
              </svg>
            )}
            {audited ? <TerrainArt hex={hex} /> : baseArt && <img className="tile-base" src={baseArt} alt="" aria-hidden="true" loading="lazy" />}
            {boardArt && <img className="tile-art" src={boardArt} alt="" aria-hidden="true" loading="lazy" />}
            {stomped && audited && <StompedMarker />}
            {stomped && !audited && <img className="tile-stomp" src="/assets/board/tokens/stomp_token.webp" alt="" aria-hidden="true" loading="lazy" />}
            {place?.kind === "infamy" && <img className="tile-infamy" src="/assets/board/tokens/infamy_token.webp" alt="" aria-hidden="true" loading="lazy" />}
            {audited && <FeatureMarkers hex={hex} />}
            {audited && visibleName && <span className="audited-city-name">{visibleName}</span>}
            <span className="tile-content">
              {place && <span className="node" aria-hidden="true">{place.kind === "city" ? "✦" : place.kind === "base" ? "⌂" : place.kind === "infamy" ? "★" : place.kind === "mutation" ? "✹" : "⚔"}</span>}
              {!audited && visibleName && <span className="tile-name">{visibleName}</span>}
            {provisionalFeatureText && <i className="location-kind provisional-feature-kind">{provisionalFeatureText}</i>}
              {place?.kind === "city" && <i className="city-hp" aria-label={`printed city benefit ${place.marker ?? "not recorded"}`}>{place.marker ?? "benefit n/a"}</i>}
              {place?.kind === "mutation" && <i className="location-kind">MUTATION</i>}
              {occupantCount > 0 && <span className={`tile-occupants stack-count-${Math.min(occupantCount, 8)}`} aria-label={`${occupantCount} occupant${occupantCount === 1 ? "" : "s"}`}>
                {monstersHere.map((monster) => {
                  const monsterArt = monsterArtForName(monster.name);
                  return monsterArt
                    ? <img className={`tile-monster tile-occupant ${acceptedPieceId === monster.id ? "accepted-arrival" : ""}`} key={monster.id} onClick={monster.id === activePlayerId && canAct && game.phase === "move" ? (event) => { if (selectedUnitId && game.phase === "move") return; event.stopPropagation(); onSelectMonster(); } : undefined} src={monsterArt} alt={monster.name} loading="lazy" />
                    : <b className={`tile-occupant ${acceptedPieceId === monster.id ? "accepted-arrival" : ""}`} key={monster.id}>{monster.name.slice(0, 1)}</b>;
                })}
                {unitsHere.map((unit) => {
                  const unitArt = unitArtForType(unit.unitTypeId);
                  return unitArt
                    ? <img className={`tile-piece tile-occupant ${selectedUnitId === unit.id ? "selected-piece" : ""} ${acceptedPieceId === unit.id ? "accepted-arrival" : ""}`} key={unit.id} onClick={game.phase === "deploy" && deploymentLegal ? (event) => { event.stopPropagation(); onDeploy(placeKey); } : game.phase === "move" ? (event) => { if (selectedUnitId || selectedPath.length > 1) return; event.stopPropagation(); if (monsterLegal) onChoosePath(placeKey); else onSelectUnit(unit.id); } : game.phase === "encounter" && selectableUnit ? (event) => { event.stopPropagation(); onSelectUnit(unit.id); } : undefined} src={unitArt} alt={`${unit.branch} ${unit.unitTypeId ?? "unit"}`} loading="lazy" />
                    : <i className={`unit-mark tile-occupant ${acceptedPieceId === unit.id ? "accepted-arrival" : ""}`} key={unit.id}>{unit.branch.slice(0, 1)}</i>;
                })}
              </span>}
            </span>
          </button>
        );
      })}
      {peekMonster && monsterPeek && createPortal(<aside className="board-monster-peek" style={{left:Math.max(8,Math.min(monsterPeek.x-160,window.innerWidth-328)),top:Math.max(8,monsterPeek.y-(peekCards.length ? 240 : 90))}}>
        <strong>{peekMonster.name}</strong><span>Health {peekMonster.health}/{peekMonster.maxHealth} · Attacks {peekMonster.attacks} · Defense {peekMonster.defense} · Damage {peekMonster.damage}</span>
        <div>{peekCards.map(id=><img key={id} src={mutationArt(id)} alt={id} title={id} />)}</div>
        {!peekCards.length && <small>No revealed mutations</small>}
      </aside>,document.body)}
    </div>
  );
}
