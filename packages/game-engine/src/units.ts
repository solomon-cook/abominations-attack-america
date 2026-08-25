export type UnitBranch = "Army" | "Navy" | "Air Force" | "Marines" | "National Guard";
export type UnitMovement = "land-only" | "fly" | "sea-seacoast-only" | "sea-seacoast-or-fly" | "stationary";

export interface UnitDefinition {
  readonly id: string;
  readonly branch: UnitBranch;
  readonly name: "Tank" | "Missile Launcher" | "Fighter" | "Nuclear Submarine" | "Rocket Launcher" | "Cruise Missile";
  readonly quantity: number;
  readonly move: number;
  readonly movement: UnitMovement;
  readonly defense: number | readonly [number, number];
  readonly damage: number | readonly [number, number];
  readonly attacks: 1;
  readonly specialAbilityText?: string;
  readonly sourceRefs: readonly string[];
  readonly effectsImplementation: "source-gated";
}

export interface GiantUnitDefinition {
  readonly id: "mecha-monster" | "captain-colossal";
  readonly name: "Mecha-Monster" | "Captain Colossal";
  readonly health: number;
  readonly move: number;
  readonly movement: "land-only" | "land-lake-sea";
  readonly defense: number;
  readonly attacks: number;
  readonly damage: number;
  readonly sourceRefs: readonly string[];
  readonly placementImplementation: "source-gated";
}

export interface NationalGuardDefinition {
  readonly id: "national-guard-tank" | "national-guard-fighter";
  readonly name: "Tank" | "Fighter";
  readonly quantity: number;
  readonly move: 3 | 5;
  readonly defense: number;
  readonly damage: 1;
  readonly specialAbilityText: "Only the player with the Guard Commander card can move Guard units.";
  readonly sourceRefs: readonly string[];
  readonly controlImplementation: "source-gated";
}

export interface BranchDeploymentDefinition {
  readonly branch: "Army" | "Navy" | "Air Force" | "Marines";
  readonly ownOrGuardUnits: number;
  readonly additionalNationalGuardUnits: number;
  readonly canDrawResearchInstead: true;
  readonly sourceRefs: readonly string[];
  readonly implementation: "source-gated";
}

const armyNavy = "references/monsters-menace-america/components/military-records/army-navy.jpg";
const marinesAirForce = "references/monsters-menace-america/components/military-records/marines-air-force.jpg";
const giantNationalGuard = "references/monsters-menace-america/components/military-records/giant-units-national-guard.jpg";

export const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  { id: "army-tank", branch: "Army", name: "Tank", quantity: 5, move: 4, movement: "land-only", defense: 5, damage: 1, attacks: 1, sourceRefs: [armyNavy], effectsImplementation: "source-gated" },
  { id: "army-missile-launcher", branch: "Army", name: "Missile Launcher", quantity: 3, move: 4, movement: "land-only", defense: 3, damage: 1, attacks: 1, specialAbilityText: "Makes an extra attack during the first round of combat before the monster attacks.", sourceRefs: [armyNavy], effectsImplementation: "source-gated" },
  { id: "navy-fighter", branch: "Navy", name: "Fighter", quantity: 5, move: 6, movement: "fly", defense: 4, damage: 1, attacks: 1, sourceRefs: [armyNavy], effectsImplementation: "source-gated" },
  { id: "navy-nuclear-submarine", branch: "Navy", name: "Nuclear Submarine", quantity: 3, move: 4, movement: "sea-seacoast-or-fly", defense: [5, 6], damage: [1, 3], attacks: 1, specialAbilityText: "May be launched as a cruise missile into combat against a monster; use the starred statistics, destroy the missile after the first round, and mutate the monster if the cruise-missile attack roll is 1.", sourceRefs: [armyNavy], effectsImplementation: "source-gated" },
  { id: "marines-fighter", branch: "Marines", name: "Fighter", quantity: 4, move: 5, movement: "fly", defense: 4, damage: 1, attacks: 1, sourceRefs: [marinesAirForce], effectsImplementation: "source-gated" },
  { id: "marines-rocket-launcher", branch: "Marines", name: "Rocket Launcher", quantity: 4, move: 4, movement: "land-only", defense: 3, damage: 2, attacks: 1, sourceRefs: [marinesAirForce], effectsImplementation: "source-gated" },
  { id: "air-force-fighter", branch: "Air Force", name: "Fighter", quantity: 6, move: 6, movement: "fly", defense: 4, damage: 1, attacks: 1, sourceRefs: [marinesAirForce], effectsImplementation: "source-gated" },
  { id: "air-force-cruise-missile", branch: "Air Force", name: "Cruise Missile", quantity: 2, move: 8, movement: "fly", defense: 6, damage: 1, attacks: 1, specialAbilityText: "Destroyed after the first round of combat; if the cruise-missile attack roll is 1, the monster mutates.", sourceRefs: [marinesAirForce], effectsImplementation: "source-gated" },
];

export const GIANT_UNIT_DEFINITIONS: readonly GiantUnitDefinition[] = [
  { id: "mecha-monster", name: "Mecha-Monster", health: 6, move: 4, movement: "land-only", defense: 5, attacks: 1, damage: 4, sourceRefs: [giantNationalGuard], placementImplementation: "source-gated" },
  { id: "captain-colossal", name: "Captain Colossal", health: 8, move: 4, movement: "land-lake-sea", defense: 4, attacks: 2, damage: 2, sourceRefs: [giantNationalGuard], placementImplementation: "source-gated" },
];

export const NATIONAL_GUARD_DEFINITIONS: readonly NationalGuardDefinition[] = [
  { id: "national-guard-tank", name: "Tank", quantity: 6, move: 3, defense: 4, damage: 1, specialAbilityText: "Only the player with the Guard Commander card can move Guard units.", sourceRefs: [giantNationalGuard], controlImplementation: "source-gated" },
  { id: "national-guard-fighter", name: "Fighter", quantity: 2, move: 5, defense: 3, damage: 1, specialAbilityText: "Only the player with the Guard Commander card can move Guard units.", sourceRefs: [giantNationalGuard], controlImplementation: "source-gated" },
];

export const BRANCH_DEPLOYMENT_DEFINITIONS: readonly BranchDeploymentDefinition[] = [
  { branch: "Army", ownOrGuardUnits: 2, additionalNationalGuardUnits: 1, canDrawResearchInstead: true, sourceRefs: [armyNavy], implementation: "source-gated" },
  { branch: "Navy", ownOrGuardUnits: 2, additionalNationalGuardUnits: 1, canDrawResearchInstead: true, sourceRefs: [armyNavy], implementation: "source-gated" },
  { branch: "Air Force", ownOrGuardUnits: 2, additionalNationalGuardUnits: 1, canDrawResearchInstead: true, sourceRefs: [marinesAirForce], implementation: "source-gated" },
  { branch: "Marines", ownOrGuardUnits: 3, additionalNationalGuardUnits: 0, canDrawResearchInstead: true, sourceRefs: [marinesAirForce], implementation: "source-gated" },
];
