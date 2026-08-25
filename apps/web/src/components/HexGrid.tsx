import {
  buildBoardIndex,
  DEVELOPMENT_BOARD,
  FULL_HONEYCOMB_BOARD,
  getLocation,
  locationIdToHexKey,
  locations,
  type GameState,
  type HexKey,
} from "@abominations/game-engine";
import { buildDisplayHexLayout } from "../board-layout";

const developmentHexes = Object.values(DEVELOPMENT_BOARD.hexes);
const developmentBoardIndex = buildBoardIndex(DEVELOPMENT_BOARD);
const boardHexes = buildDisplayHexLayout().map(({ hex, left, top }) => ({
  hex,
  place: locations.find((candidate) => locationIdToHexKey(candidate.id) === hex.key),
  left,
  top,
}));
const displayByKey = new Map(boardHexes.map(({ hex, left, top }) => [hex.key, { left, top }]));

function boardArtForHex(hex: (typeof boardHexes)[number]["hex"], place?: (typeof locations)[number]) {
  if (place?.kind === "city") return "/assets/board/coastal-city/small/coastal_city_0deg.webp";
  const feature = hex.features[0]?.kind;
  const featureAssets: Record<string, string> = {
    "military-base": "/assets/board/features/military_base.webp",
    "infamy-site": "/assets/board/features/infamy_site.webp",
    "mutation-site": "/assets/board/features/mutation_site.webp",
    "challenge-site": "/assets/board/features/challenge_site.webp",
    lair: "/assets/board/features/lair.webp",
    hollywood: "/assets/board/features/hollywood.webp",
    "los-angeles": "/assets/board/features/los_angeles.webp",
  };
  return featureAssets[feature ?? ""];
}

function unitArtForType(unitTypeId?: string) {
  return unitTypeId ? `/assets/military/${unitTypeId}.webp` : undefined;
}

function monsterArtForName(name: string) {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  return ["gargantis", "konk", "megaclaw", "tomanagi", "toxicor", "zorb"].includes(slug)
    ? `/assets/monsters/${slug}.webp`
    : undefined;
}

type Props = {
  game: GameState;
  activePlayerId: string;
  canAct: boolean;
  legalDestinations: ReadonlySet<HexKey>;
  legalUnitDestinations: ReadonlySet<HexKey>;
  selectableUnitIds: ReadonlySet<string>;
  selectedUnitId: string | null;
  selectedPath: readonly HexKey[];
  selectedUnitPath: readonly HexKey[];
  acceptedPath: readonly HexKey[];
  acceptedPieceId?: string;
  acceptedAnimationKey?: number;
  onSelectUnit: (unitId: string) => void;
  onChoosePath: (destination: HexKey) => void;
  onChooseUnitPath: (destination: HexKey) => void;
};

export function HexGrid({ game, activePlayerId, canAct, legalDestinations, legalUnitDestinations, selectableUnitIds, selectedUnitId, selectedPath, selectedUnitPath, acceptedPath, acceptedPieceId, acceptedAnimationKey, onSelectUnit, onChoosePath, onChooseUnitPath }: Props) {
  const activePlayer = game.monsters.find((monster) => monster.id === activePlayerId);
  const path = selectedUnitId ? selectedUnitPath : selectedPath;
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
  return (
    <div className="hex-grid">
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
      {boardHexes.map(({ hex, place, left, top }) => {
        const placeKey = hex.key;
        const monsterLegal = legalDestinations.has(placeKey);
        const unitLegal = legalUnitDestinations.has(placeKey);
        const selectableUnit = game.units.find((unit) => unit.location === placeKey && selectableUnitIds.has(unit.id));
        const featureText = hex.features.map((feature) => feature.kind).join(", ");
        const neighbourText = (developmentBoardIndex.neighbours[placeKey] ?? [])
          .map((neighbourKey) => developmentHexes.find((candidate) => candidate.key === neighbourKey)?.label ?? neighbourKey)
          .join(", ");
        const occupantText = [
          ...game.monsters.filter((monster) => monster.location === placeKey).map((monster) => monster.name),
          ...game.units.filter((unit) => unit.location === placeKey).map((unit) => `${unit.branch} unit`),
        ].join(", ");
        const displayName = place?.name ?? hex.label ?? `Unresolved ${hex.key}`;
        const locationMeta = place?.kind === "city"
          ? `city, ${place.marker ?? "benefit not recorded"}`
          : place?.kind === "mutation"
            ? "Mutation space"
            : undefined;
        const baseArt = hex.waterClass === "land"
          ? "/assets/board/grassland.webp"
          : "/assets/board/coast/coast_0deg.webp";
        const boardArt = boardArtForHex(hex, place);
        const stomped = game.stompedLocations.includes(placeKey);
        return (
          <button
            key={hex.key}
            aria-label={`${displayName}${locationMeta ? `, ${locationMeta}` : ""}, hex ${hex.key}, neighbours ${neighbourText || "none recorded"}, ${featureText || "no recorded feature"}${occupantText ? `, occupied by ${occupantText}` : ", unoccupied"}, ${selectableUnit ? `select ${selectableUnit.branch} unit` : monsterLegal || unitLegal ? "legal destination" : "not currently reachable"}`}
            data-hex-key={hex.key}
            disabled={!place || !canAct || game.phase !== "move" || (!monsterLegal && !unitLegal && !selectableUnit)}
            className={`hex-tile ${place?.kind ?? "unresolved"} ${hex.waterClass === "land" ? "land" : "water"} ${placeKey === activePlayer?.location ? "active" : ""} ${monsterLegal || unitLegal ? "legal" : selectableUnit ? "selectable" : "unreachable"} ${path.at(-1) === placeKey ? "selected" : ""} ${path.includes(placeKey) ? "path-selected" : ""}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            onClick={() => selectableUnit && !monsterLegal && !unitLegal ? onSelectUnit(selectableUnit.id) : selectedUnitId ? onChooseUnitPath(placeKey) : onChoosePath(placeKey)}
          >
            <img className="tile-base" src={baseArt} alt="" aria-hidden="true" loading="lazy" />
            {boardArt && <img className="tile-art" src={boardArt} alt="" aria-hidden="true" loading="lazy" />}
            {stomped && <img className="tile-stomp" src="/assets/board/tokens/stomp_token.webp" alt="" aria-hidden="true" loading="lazy" />}
            {place?.kind === "infamy" && <img className="tile-infamy" src="/assets/board/tokens/infamy_token.webp" alt="" aria-hidden="true" loading="lazy" />}
            <span className="tile-content">
              <span className="node" aria-hidden="true">{place?.kind === "city" ? "✦" : place?.kind === "base" ? "⌂" : place?.kind === "infamy" ? "★" : place?.kind === "mutation" ? "✹" : place ? "⚔" : "·"}</span>
              <span>{displayName}</span>
              {place?.kind === "city" && <i className="city-hp" aria-label={`printed city benefit ${place.marker ?? "not recorded"}`}>{place.marker ?? "benefit n/a"}</i>}
              {place?.kind === "mutation" && <i className="location-kind">MUTATION</i>}
              {game.monsters.filter((monster) => monster.location === placeKey).map((monster) => {
                const monsterArt = monsterArtForName(monster.name);
                return monsterArt
                  ? <img className={`tile-monster ${acceptedPieceId === monster.id ? "accepted-arrival" : ""}`} key={monster.id} src={monsterArt} alt={monster.name} loading="lazy" />
                  : <b className={acceptedPieceId === monster.id ? "accepted-arrival" : ""} key={monster.id}>{monster.name.slice(0, 1)}</b>;
              })}
              {game.units.filter((unit) => unit.location === placeKey).map((unit) => {
                const unitArt = unitArtForType(unit.unitTypeId);
                return unitArt
                  ? <img className={`tile-piece ${selectedUnitId === unit.id ? "selected-piece" : ""} ${acceptedPieceId === unit.id ? "accepted-arrival" : ""}`} key={unit.id} src={unitArt} alt={`${unit.branch} ${unit.unitTypeId ?? "unit"}`} loading="lazy" />
                  : <i className="unit-mark" key={unit.id}>{unit.branch.slice(0, 1)}</i>;
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
