import type { CSSProperties } from "react";
import { BRANCH_DEPLOYMENT_DEFINITIONS, GIANT_UNIT_DEFINITIONS, NATIONAL_GUARD_DEFINITIONS, UNIT_DEFINITIONS, type GameState } from "@abominations/game-engine";

export const movementLabel = (value: string) => ({ "land-only": "Land only", "land-lake": "Land and lakes", "land-lake-sea": "Land, lakes and sea", fly: "Fly", "sea-seacoast-only": "Sea and seacoast", "sea-seacoast-or-fly": "Sea and seacoast; missile flies", stationary: "Stationary" })[value] ?? value;
const printedValue = (value: number | readonly [number, number]) => typeof value === "number" ? String(value) : `${value[0]} / ${value[1]} as missile`;

export function SheetStats({ values }: { values: Record<string, string | number> }) {
  return <dl className="sheet-stats">{Object.entries(values).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function SourcePhoto({ file }: { file: string }) {
  return <details className="sheet-source"><summary>View original physical sheet</summary><img src={`/assets/reference-sheets/${file}`} alt="Photograph of the original physical record sheet" loading="lazy" /></details>;
}

function ReserveSlots({ typeId, quantity, game }: { typeId: string; quantity: number; game?: GameState }) {
  const units = game?.units.filter((unit) => unit.unitTypeId === typeId) ?? [];
  const reserve = typeId.startsWith("national-guard-")
    ? (game?.nationalGuard.unitIds.filter((id) => id.startsWith(`${typeId}-`) && !game.units.some((unit) => unit.id === id) && !game.removedUnitIds.includes(id)).length ?? 0)
    : units.filter((unit) => unit.location === "record-tile" && !game?.removedUnitIds.includes(unit.id)).length;
  return <div className="record-reserve" aria-label={`${reserve} of ${quantity} ${typeId.replaceAll("-", " ")} pieces in reserve`}>
    <div className="record-reserve-slots" aria-hidden="true">{Array.from({ length: quantity }, (_, i) => <span key={i} className={`record-piece-slot ${i < reserve ? "in-reserve" : ""}`} style={{ "--piece-mask": `url(/assets/military/${typeId}.webp)` } as CSSProperties}>
      {i < reserve && <img src={`/assets/military/${typeId}.webp`} alt="" />}
    </span>)}</div>
    <span className="record-reserve-count"><b>{reserve}</b> / {quantity}<small>IN RESERVE</small></span>
  </div>;
}

export function MilitaryReference({ sheet, game }: { sheet: string; game?: GameState }) {
  const units = UNIT_DEFINITIONS.filter((unit) => unit.branch === sheet);
  const deployment = BRANCH_DEPLOYMENT_DEFINITIONS.find((definition) => definition.branch === sheet);
  const source = units[0]?.sourceRefs[0]?.split("/").at(-1) ?? (sheet === "National Guard" || sheet === "Giant" ? "giant-units-national-guard.jpg" : undefined);
  const research = game?.players[game.currentPlayer]?.researchCardIds ?? [];
  return <section className="sheet-reference" aria-label={`${sheet} reference rules`}>
    <p className="sheet-reference-note">Printed reference values · special abilities and research may change combat.</p>
    {deployment && <p><b>Deploy:</b> {deployment.ownOrGuardUnits} branch or National Guard units{deployment.additionalNationalGuardUnits ? `, plus ${deployment.additionalNationalGuardUnits} National Guard` : ""}, or draw 1 Military Research card. Guard deployment requires Guard Commander in this game.</p>}
    {units.map((unit) => <article key={unit.id}>
      <h3>{unit.name} <small>· {unit.quantity} pieces</small></h3>
      <SheetStats values={{ Move: unit.id === "navy-nuclear-submarine" ? "4 / 8 as missile" : unit.move, Movement: movementLabel(unit.movement), Attacks: unit.attacks, Defense: printedValue(unit.defense), Damage: printedValue(unit.damage) }} />
      <ReserveSlots typeId={unit.id} quantity={unit.quantity} game={game} />
      {unit.specialAbilityText && <p>{unit.specialAbilityText}</p>}
    </article>)}
    {sheet === "National Guard" && <>
      <p><b>Deploy:</b> An unstomped city, military base, or Infamy site.</p>
      {NATIONAL_GUARD_DEFINITIONS.map((unit) => <article key={unit.id}><h3>{unit.name} <small>· {unit.quantity} pieces</small></h3><SheetStats values={{ "Printed move": unit.printedMove, "With Guard Commander": unit.move, Movement: unit.name === "Fighter" ? "Fly with commander" : "Land with commander", Attacks: 1, Defense: unit.defense, Damage: unit.damage }} /><ReserveSlots typeId={unit.id} quantity={unit.quantity} game={game} /><p>{unit.specialAbilityText}</p></article>)}
      <p>Guard Commander: {research.includes("Guard Commander") ? "active" : "not held by this player"}.</p>
    </>}
    {sheet === "Giant" && GIANT_UNIT_DEFINITIONS.map((unit) => <article key={unit.id}><h3>{unit.name}</h3><SheetStats values={{ Health: unit.health, Move: unit.move, Movement: movementLabel(unit.movement), Attacks: unit.attacks, Defense: unit.defense, Damage: unit.damage }} /></article>)}
    {sheet === "X-Fighters" && game?.units.filter((unit) => unit.unitTypeId === "x-fighter" && unit.ownerPlayer === game.currentPlayer).slice(0, 1).map((unit) => <article key={unit.id}><h3>X-Fighters</h3><p>Research units · current game values. Deploy in place of a branch unit.</p><SheetStats values={{ Move: unit.move, Movement: movementLabel(unit.movement), Attacks: unit.attacks, Defense: unit.defense, Damage: unit.damage }} /></article>)}
    {source && <SourcePhoto file={source} />}
  </section>;
}
