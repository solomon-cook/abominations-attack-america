import type { BoardFeature, BoardHex } from "@abominations/game-engine";

/** Plain-language detail shared by the focused board tile and its inspection tray. */
export function boardFeatureLabel(feature: BoardFeature): string {
  switch (feature.kind) {
    case "city":
      return feature.benefit.kind === "health"
        ? `City, +${feature.benefit.amount} Health`
        : `City, ${feature.benefit.dice} dice for Health`;
    case "military-base": return `${feature.branch} base`;
    case "infamy-site": return "Infamy site";
    case "mutation-site": return "Mutation site";
    case "challenge-site": return "Challenge site";
    case "lair": return `${feature.monsterId} lair`;
    case "los-angeles": return "Los Angeles area";
  }
}

export function boardHexFeatureLabel(hex: BoardHex): string {
  return hex.features.length === 0
    ? "No recorded feature"
    : hex.features.map(boardFeatureLabel).join("; ");
}
