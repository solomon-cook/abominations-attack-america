import type { DeploymentChoice } from "./MilitarySheet";
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

function ReserveSlots({ typeId, quantity, game, choices = [], onSelect }: { typeId: string; quantity: number; game?: GameState; choices?: readonly DeploymentChoice[]; onSelect?: (choice: DeploymentChoice) => void }) {
  const pieces = typeId.startsWith("national-guard-")
    ? (game?.nationalGuard.unitIds.filter((id) => id.startsWith(typeId) && !game.removedUnitIds.includes(id)).map((id) => ({ id, reserve: !game.units.some((unit) => unit.id === id && unit.location !== "record-tile") })) ?? [])
    : (game?.units.filter((unit) => unit.unitTypeId === typeId && (typeId !== "x-fighter" || unit.ownerPlayer === game.currentPlayer) && !game.removedUnitIds.includes(unit.id)).map((unit) => ({ id: unit.id, reserve: unit.location === "record-tile" })) ?? []);
  const reserve = pieces.filter((piece) => piece.reserve).length;
  return <div className="record-reserve" aria-label={`${reserve} of ${quantity} ${typeId.replaceAll("-", " ")} pieces in reserve`}>
    <div className="record-reserve-slots">{Array.from({ length: quantity }, (_, i) => {
      const piece = pieces[i];
      const choice = choices.find((candidate) => candidate.id === piece?.id);
      const art = <img src={typeId === "mecha-monster" || typeId === "captain-colossal" ? `/assets/cards/military-research-${typeId}.webp` : `/assets/military/${typeId}.webp`} alt="" />;
      const style = { "--piece-mask": `url(/assets/military/${typeId}.webp)` } as CSSProperties;
      return choice && onSelect ? <button type="button" key={piece!.id} className={`record-piece-slot selectable-record-piece ${piece!.reserve ? "in-reserve" : "on-board"}`} style={style}
        aria-label={`${choice.kind === "deploy" ? "Deploy" : "Redeploy"} ${typeId.replaceAll("-", " ")} piece ${i + 1}`} onClick={() => onSelect(choice)}>{art}<span>{choice.kind === "deploy" ? "Deploy" : "Redeploy"}</span></button>
        : <span key={piece?.id ?? i} className={`record-piece-slot ${piece?.reserve ? "in-reserve" : ""}`} style={style} aria-label={piece?.reserve ? "In reserve; no legal deployment now" : "Not in reserve"}>{piece?.reserve && art}</span>;
    })}</div>
    <span className="record-reserve-count"><b>{reserve}</b> / {quantity}<small>IN RESERVE</small></span>
  </div>;
}

export function MilitaryReference({ sheet, game, choices, onSelect }: { sheet: string; game?: GameState; choices?: readonly DeploymentChoice[]; onSelect?: (choice: DeploymentChoice) => void }) {
  const units = UNIT_DEFINITIONS.filter((unit) => unit.branch === sheet);
  const deployment = BRANCH_DEPLOYMENT_DEFINITIONS.find((definition) => definition.branch === sheet);
  const source = units[0]?.sourceRefs[0]?.split("/").at(-1) ?? (sheet === "National Guard" || sheet === "Giant" || sheet === "Mecha-Monster" || sheet === "Captain Colossal" ? "giant-units-national-guard.jpg" : undefined);
  const research = game?.players[game.currentPlayer]?.researchCardIds ?? [];
  return <section className="sheet-reference" aria-label={`${sheet} reference rules`}>
    <p className="sheet-reference-note">Printed reference values · special abilities and research may change combat.</p>
    {deployment && <p><b>Deploy:</b> {deployment.ownOrGuardUnits} branch or National Guard units{deployment.additionalNationalGuardUnits ? `, plus ${deployment.additionalNationalGuardUnits} National Guard` : ""}, or draw 1 Military Research card. Anyone may deploy Guard unless another player holds Guard Commander.</p>}
    {units.map((unit) => <article key={unit.id}>
      <h3>{unit.name} <small>· {unit.quantity} pieces</small></h3>
      <SheetStats values={{ Move: unit.id === "navy-nuclear-submarine" ? "4 / 8 as missile" : unit.move, Movement: movementLabel(unit.movement), Attacks: unit.attacks, Defense: printedValue(unit.defense), Damage: printedValue(unit.damage) }} />
      <ReserveSlots typeId={unit.id} quantity={unit.quantity} game={game} choices={choices} onSelect={onSelect} />
      {unit.specialAbilityText && <p>{unit.specialAbilityText}</p>}
    </article>)}
    {sheet === "National Guard" && <>
      <p><b>Deploy:</b> An unstomped city, military base, or Infamy site.</p>
      {NATIONAL_GUARD_DEFINITIONS.map((unit) => <article key={unit.id}><h3>{unit.name} <small>· {unit.quantity} pieces</small></h3><SheetStats values={{ "Printed move": unit.printedMove, "With Guard Commander": unit.move, Movement: unit.name === "Fighter" ? "Fly with commander" : "Land with commander", Attacks: 1, Defense: unit.defense, Damage: unit.damage }} /><ReserveSlots typeId={unit.id} quantity={unit.quantity} game={game} choices={choices} onSelect={onSelect} /><p>{unit.specialAbilityText}</p></article>)}
      <p>Guard Commander: {research.includes("Guard Commander") ? "active" : "not held by this player"}.</p>
    </>}
    {GIANT_UNIT_DEFINITIONS.filter((unit) => sheet === "Giant" || unit.name === sheet).map((unit) => <article key={unit.id}><h3>{unit.name}</h3><SheetStats values={{ Health: unit.health, Move: unit.move, Movement: movementLabel(unit.movement), Attacks: unit.attacks, Defense: unit.defense, Damage: unit.damage }} /><ReserveSlots typeId={unit.id} quantity={unit.quantity} game={game} choices={choices} onSelect={onSelect} /></article>)}
    {sheet === "X-Fighters" && game?.units.filter((unit) => unit.unitTypeId === "x-fighter" && unit.ownerPlayer === game.currentPlayer).slice(0, 1).map((unit) => <article key={unit.id}><h3>X-Fighters</h3><p>Research units · current game values. Deploy in place of a branch unit.</p><SheetStats values={{ Move: unit.move, Movement: movementLabel(unit.movement), Attacks: unit.attacks, Defense: unit.defense, Damage: unit.damage }} /><ReserveSlots typeId="x-fighter" quantity={game.units.filter((piece) => piece.unitTypeId === "x-fighter" && piece.ownerPlayer === game.currentPlayer).length} game={game} choices={choices} onSelect={onSelect} /></article>)}
    {source && <SourcePhoto file={source} />}
  </section>;
}
