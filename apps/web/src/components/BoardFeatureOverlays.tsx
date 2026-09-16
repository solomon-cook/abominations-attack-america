import type { BoardHex } from "@abominations/game-engine";
import "../board-feature-overlays.css";

/** Decorative assets only; coordinates, terrain and game pieces belong to the board. */
export function FeatureMarkers({ hex }: { hex: BoardHex }) {
  const bases = hex.features.filter(feature => feature.kind === "military-base");
  const sites = hex.features.filter(feature => feature.kind !== "military-base" && feature.kind !== "los-angeles" && feature.kind !== "challenge-site" && feature.kind !== "lair");
  return <span className="audited-features" aria-hidden="true">
    {hex.features.some(feature => feature.kind === "challenge-site") && <img className="hex-challenge-overlay" src="/assets/board/overlays/challenge-site.svg?v=vector-2" alt="" title="Monster Challenge site" draggable={false} />}
    {hex.features.filter(feature => feature.kind === "lair").map((feature, index) => <img key={index} className="hex-lair-overlay" src={`/assets/board/overlays/lair-${feature.monsterId}.svg?v=vector-2`} alt="" title={`${feature.monsterId} lair`} draggable={false} />)}
    <span className="hex-upper-features">{sites.map((feature, index) => {
      let asset: string;
      let label: string;
      if (feature.kind === "city") {
        asset = feature.benefit.kind === "health" ? "city-health" : `city-${feature.benefit.dice}d`;
        label = feature.benefit.kind === "health" ? `${feature.benefit.amount} HP` : `${feature.benefit.dice}D`;

      } else {
        asset = feature.kind; label = feature.kind.replaceAll("-", " ");
      }
      return <img key={index} className="hex-feature-symbol" src={`/assets/board/overlays/${asset}.svg?v=vector-2`} alt="" title={label} draggable={false} />;
    })}</span>
    <span className="hex-lower-bases">{bases.map((feature, index) =>
      <img key={index} className="hex-base-star" src={`/assets/board/overlays/base-${feature.branch.toLowerCase().replaceAll(" ", "-")}.svg?v=vector-2`} alt="" title={`${feature.branch} base`} draggable={false} />
    )}</span>
  </span>;
}


/** Game-state marker above printed features and below movable pieces. */
export function StompedMarker() {
  return <span className="board-stomp-marker" aria-hidden="true">
    <img src="/assets/board/tokens/stomp_token.webp" alt="" draggable={false} />
    <span>STOMPED</span>
  </span>;
}
