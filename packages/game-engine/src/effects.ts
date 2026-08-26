import type { MonsterMovement } from "./monsters.js";

export type EffectCategory = "stat-modifier" | "movement-ability" | "attack-change" | "control-override" | "placement" | "triggered";
export type EffectAvailability = "implemented" | "source-gated";

export interface EffectBoundary {
  readonly id: string;
  readonly category: EffectCategory;
  readonly availability: EffectAvailability;
  readonly timing: string;
  readonly sourceRefs: readonly string[];
}

/** The engine may only resolve an effect after its source boundary is explicit. */
export const EFFECT_BOUNDARIES: readonly EffectBoundary[] = [
  { id: "continuous-projection", category: "stat-modifier", availability: "implemented", timing: "before selectors and combat", sourceRefs: ["docs/effect-precedence.md"] },
  { id: "movement-ability-projection", category: "movement-ability", availability: "implemented", timing: "during movement legality", sourceRefs: ["docs/effect-precedence.md"] },
  { id: "attack-window-effects", category: "attack-change", availability: "implemented", timing: "at the authoritative battle window", sourceRefs: ["docs/effect-precedence.md"] },
  { id: "control-overrides", category: "control-override", availability: "implemented", timing: "at command legality", sourceRefs: ["docs/effect-precedence.md"] },
  { id: "verified-card-placement", category: "placement", availability: "implemented", timing: "during Deploy with an authored destination", sourceRefs: ["docs/effect-precedence.md"] },
  { id: "verified-event-triggers", category: "triggered", availability: "implemented", timing: "immediately after the recorded event", sourceRefs: ["docs/effect-precedence.md"] },
  { id: "unresolved-production-effect", category: "placement", availability: "source-gated", timing: "not resolved until source review", sourceRefs: ["docs/unresolved-rules-inventory.md"] },
];

export interface ContinuousEffectAccumulator {
  readonly moveBonus: number;
  readonly defenseBonus: number;
  readonly waterBarrierDefenseBonus: number;
  readonly damagePerHit?: number;
  readonly firstRoundAttackBonus: number;
  readonly extraDeployments: number;
  readonly movement?: MonsterMovement;
  readonly crossesWaterBarriers: boolean;
  readonly canControlNationalGuard: boolean;
  readonly canDeployNationalGuard: boolean;
}

export type ContinuousEffectContribution = Partial<ContinuousEffectAccumulator>;

/**
 * Compose only effects whose source and lifecycle are implemented. Numeric
 * modifiers add, replacement abilities use the last explicit value, and
 * boolean permissions compose as OR. Other effect categories stay at their
 * authoritative timing boundary rather than being inferred here.
 */
export function composeContinuousEffects(contributions: readonly ContinuousEffectContribution[]): ContinuousEffectAccumulator {
  const result = {
    moveBonus: 0,
    defenseBonus: 0,
    waterBarrierDefenseBonus: 0,
    firstRoundAttackBonus: 0,
    extraDeployments: 0,
    crossesWaterBarriers: false,
    canControlNationalGuard: false,
    canDeployNationalGuard: false,
  };
  let damagePerHit: number | undefined;
  let movement: MonsterMovement | undefined;
  for (const contribution of contributions) {
    result.moveBonus += contribution.moveBonus ?? 0;
    result.defenseBonus += contribution.defenseBonus ?? 0;
    result.waterBarrierDefenseBonus += contribution.waterBarrierDefenseBonus ?? 0;
    result.firstRoundAttackBonus += contribution.firstRoundAttackBonus ?? 0;
    result.extraDeployments += contribution.extraDeployments ?? 0;
    result.crossesWaterBarriers ||= contribution.crossesWaterBarriers ?? false;
    result.canControlNationalGuard ||= contribution.canControlNationalGuard ?? false;
    result.canDeployNationalGuard ||= contribution.canDeployNationalGuard ?? false;
    if (contribution.damagePerHit !== undefined) damagePerHit = contribution.damagePerHit;
    if (contribution.movement !== undefined) movement = contribution.movement;
  }
  return { ...result, damagePerHit, movement };
}
