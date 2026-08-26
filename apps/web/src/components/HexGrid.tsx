import {
  buildBoardIndex,
  FULL_HONEYCOMB_BOARD,
  PROVISIONAL_AUTHORITATIVE_BOARD,
  locationIdToHexKey,
  isHexKey,
  locations,
  type GameState,
  type HexKey,
  type BoardHex,
} from "@abominations/game-engine";
import { buildDisplayHexLayout } from "../board-layout";
import { boardForGame } from "../board-pin";

function displayHexesForGame(game: GameState) {
  const board = boardForGame(game);
  if (!board) return [];
  if (board.id === FULL_HONEYCOMB_BOARD.id || board.id === PROVISIONAL_AUTHORITATIVE_BOARD.id) {
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
    hollywood: "/assets/board/features/hollywood.webp",
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
    case "hollywood": return "HOLLYWOOD";
    case "los-angeles": return "LOS ANGELES";
    default: return undefined;
  }
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
  hoveredPath: readonly HexKey[];
  selectedUnitPath: readonly HexKey[];
  acceptedPath: readonly HexKey[];
  acceptedPieceId?: string;
  acceptedAnimationKey?: number;
  onSelectUnit: (unitId: string) => void;
  onChoosePath: (destination: HexKey) => void;
  onChooseUnitPath: (destination: HexKey) => void;
  onPreviewPath: (destination: HexKey) => void;
  onClearPreview: () => void;
};

export function HexGrid({ game, activePlayerId, canAct, legalDestinations, legalUnitDestinations, selectableUnitIds, selectedUnitId, selectedPath, hoveredPath, selectedUnitPath, acceptedPath, acceptedPieceId, acceptedAnimationKey, onSelectUnit, onChoosePath, onChooseUnitPath, onPreviewPath, onClearPreview }: Props) {
  const board = boardForGame(game);
  const boardHexes = displayHexesForGame(game);
  const boardIndex = board ? buildBoardIndex(board) : undefined;
  const activeNeighbours = new Set(board && isHexKey(game.monsters.find((monster) => monster.id === activePlayerId)?.location ?? "")
    ? boardIndex?.neighbours[game.monsters.find((monster) => monster.id === activePlayerId)!.location as HexKey] ?? []
    : []);
  const displayByKey = new Map(boardHexes.map(({ hex, left, top }) => [hex.key, { left, top }]));
  const activePlayer = game.monsters.find((monster) => monster.id === activePlayerId);
  const selectedDisplayPath = selectedUnitId ? selectedUnitPath : selectedPath;
  const path = hoveredPath.length > 1 ? hoveredPath : selectedDisplayPath;
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
        const monsterLegal = legalDestinations.has(placeKey);
        const unitLegal = legalUnitDestinations.has(placeKey);
        const selectableUnit = game.units.find((unit) => unit.location === placeKey && selectableUnitIds.has(unit.id));
        const featureText = hex.features.map((feature) => feature.kind).join(", ");
        const neighbourText = (boardIndex?.neighbours[placeKey] ?? [])
          .map((neighbourKey) => board?.hexes[neighbourKey]?.label ?? neighbourKey)
          .join(", ");
        const occupantText = [
          ...game.monsters.filter((monster) => monster.location === placeKey).map((monster) => monster.name),
          ...game.units.filter((unit) => unit.location === placeKey).map((unit) => `${unit.branch} unit`),
        ].join(", ");
        const displayName = place?.name ?? hex.label ?? `Unresolved ${hex.key}`;
        const provisionalFeatureName = board?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id && hex.features.some((feature) => feature.kind === "city")
          ? hex.label
          : undefined;
        const provisionalFeatureText = board?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id ? provisionalFeatureLabel(hex) : undefined;
        const visibleName = place?.name ?? (developmentFixture ? hex.label : provisionalFeatureName ?? "");
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
          ...game.units.filter((unit) => unit.location === placeKey).map((unit) => `${unit.branch} ${unit.attacks} attack${unit.attacks === 1 ? "" : "s"}/${unit.damage} damage/${unit.defense} Defense`),
          ...game.monsters.filter((monster) => monster.location === placeKey).map((monster) => `${monster.name} ${monster.health}/${monster.maxHealth} Health/${monster.infamy} Infamy`),
        ].join(", ");
        const tooltipText = [
          `${displayName || `Hex ${hex.key}`} · ${hex.key}`,
          `${hex.waterClass} water class`,
          featureText || "No recorded feature",
          neighbourText ? `Neighbours: ${neighbourText}` : "No recorded neighbours",
          occupantText ? `Occupants: ${occupantText}` : "Unoccupied",
          selectedPathCost !== undefined && selectedPathCost > 0 ? `Movement cost: ${selectedPathCost}` : "Movement cost: not recorded for this hex",
          combatStrength ? `Combat strength: ${combatStrength}` : "Combat strength: no occupant recorded",
          hex.verification !== "verified" ? "Physical details remain source-gated" : interactionHint,
        ].join(" · ");
        const baseArt = hex.waterClass === "unresolved"
          ? undefined
          : hex.waterClass === "land"
            ? "/assets/board/grassland.webp"
            : "/assets/board/coast/coast_0deg.webp";
        const boardArt = boardArtForHex(hex, place);
        const stomped = game.stompedLocations.includes(placeKey);
        const monstersHere = game.monsters.filter((monster) => monster.location === placeKey);
        const unitsHere = game.units.filter((unit) => unit.location === placeKey);
        const occupantCount = monstersHere.length + unitsHere.length;
        return (
          <button
            key={hex.key}
            aria-label={`${displayName}${locationMeta ? `, ${locationMeta}` : ""}, hex ${hex.key}, neighbours ${neighbourText || "none recorded"}, ${featureText || "no recorded feature"}${occupantText ? `, occupied by ${occupantText}` : ", unoccupied"}, ${selectableUnit ? `select ${selectableUnit.branch} unit` : monsterLegal || unitLegal ? "legal destination" : "not currently reachable"}`}
            data-hex-key={hex.key}
            data-location-name={place?.name}
            title={tooltipText}
            disabled={(!place && board?.id !== PROVISIONAL_AUTHORITATIVE_BOARD.id) || !canAct || game.phase !== "move" || (!monsterLegal && !unitLegal && !selectableUnit)}
            className={`hex-tile ${place?.kind ?? "unresolved"} ${hex.waterClass === "land" ? "land" : "water"} ${developmentFixture ? "development-fixture" : ""} ${placeKey === activePlayer?.location ? "active" : ""} ${activeNeighbours.has(placeKey) ? "adjacent" : ""} ${monsterLegal || unitLegal ? "legal" : selectableUnit ? "selectable" : "unreachable"} ${path.at(-1) === placeKey ? "selected" : ""} ${path.includes(placeKey) ? "path-selected" : ""}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            onMouseEnter={() => (monsterLegal || unitLegal) && onPreviewPath(placeKey)}
            onMouseLeave={onClearPreview}
            onClick={() => selectableUnit && !monsterLegal && !unitLegal ? onSelectUnit(selectableUnit.id) : selectedUnitId ? onChooseUnitPath(placeKey) : onChoosePath(placeKey)}
          >
            {baseArt && <img className="tile-base" src={baseArt} alt="" aria-hidden="true" loading="lazy" />}
            {boardArt && <img className="tile-art" src={boardArt} alt="" aria-hidden="true" loading="lazy" />}
            {stomped && <img className="tile-stomp" src="/assets/board/tokens/stomp_token.webp" alt="" aria-hidden="true" loading="lazy" />}
            {place?.kind === "infamy" && <img className="tile-infamy" src="/assets/board/tokens/infamy_token.webp" alt="" aria-hidden="true" loading="lazy" />}
            <span className="tile-content">
              {place && <span className="node" aria-hidden="true">{place.kind === "city" ? "✦" : place.kind === "base" ? "⌂" : place.kind === "infamy" ? "★" : place.kind === "mutation" ? "✹" : "⚔"}</span>}
              {visibleName && <span className="tile-name">{visibleName}</span>}
            {provisionalFeatureText && <i className="location-kind provisional-feature-kind">{provisionalFeatureText}</i>}
              {place?.kind === "city" && <i className="city-hp" aria-label={`printed city benefit ${place.marker ?? "not recorded"}`}>{place.marker ?? "benefit n/a"}</i>}
              {place?.kind === "mutation" && <i className="location-kind">MUTATION</i>}
              {occupantCount > 0 && <span className={`tile-occupants stack-count-${Math.min(occupantCount, 6)}`} aria-label={`${occupantCount} occupant${occupantCount === 1 ? "" : "s"}`}>
                {monstersHere.map((monster) => {
                  const monsterArt = monsterArtForName(monster.name);
                  return monsterArt
                    ? <img className={`tile-monster tile-occupant ${acceptedPieceId === monster.id ? "accepted-arrival" : ""}`} key={monster.id} src={monsterArt} alt={monster.name} loading="lazy" />
                    : <b className={`tile-occupant ${acceptedPieceId === monster.id ? "accepted-arrival" : ""}`} key={monster.id}>{monster.name.slice(0, 1)}</b>;
                })}
                {unitsHere.map((unit) => {
                  const unitArt = unitArtForType(unit.unitTypeId);
                  return unitArt
                    ? <img className={`tile-piece tile-occupant ${selectedUnitId === unit.id ? "selected-piece" : ""} ${acceptedPieceId === unit.id ? "accepted-arrival" : ""}`} key={unit.id} src={unitArt} alt={`${unit.branch} ${unit.unitTypeId ?? "unit"}`} loading="lazy" />
                    : <i className="unit-mark tile-occupant" key={unit.id}>{unit.branch.slice(0, 1)}</i>;
                })}
              </span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
