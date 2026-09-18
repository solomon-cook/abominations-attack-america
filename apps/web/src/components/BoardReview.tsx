import { useState } from "react";
import { AUDITED_BOARD, buildBoardIndex } from "@abominations/game-engine";
import { buildDisplayHexLayout } from "../board-layout";
import { TerrainArt, BoardGridLines, cellArt } from "./BoardTerrain";

type Props = { onClose: () => void };

const stackFixtureAssets = [
  "/assets/monsters/zorb.webp",
  "/assets/military/army-tank.webp",
  "/assets/monsters/konk.webp",
  "/assets/military/army-tank.webp",
  "/assets/monsters/megaclaw.webp",
  "/assets/military/air-force-fighter.webp",
  "/assets/monsters/gargantis-light.webp",
  "/assets/military/army-tank.webp",
];

/** Read-only geometry review; unresolved board data must never become a match. */
export function BoardReview({ onClose }: Props) {
  const cells = buildDisplayHexLayout(AUDITED_BOARD);
  const [selectedKey, setSelectedKey] = useState(cells[0]?.hex.key);
  const selectedHex = cells.find(({ hex }) => hex.key === selectedKey)?.hex ?? cells[0]?.hex;
  return (
    <main className="board-review-screen">
      <header className="board-review-header">
        <div>
          <p className="eyebrow">ABOMINATIONS ATTACK AMERICA · BOARD REVIEW</p>
          <h1>Audited North America board</h1>
          <p className="board-review-lede">
            The 336 audited cells used by new games. Select a cell to inspect its geography, features, neighbours and artwork assignment.
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>Back to home</button>
      </header>
      <section className="board-review-warning" role="status">
        <strong>HUMAN-AUDITED BOARD · 336 CELLS</strong>
        <span>This view uses the same board definition and cell artwork as local and online matches.</span>
      </section>
      <div className="board-review-layout">
        <div className="board-review-visuals">
          <section className="board-review-frame" aria-label="336-cell audited North America map">
            <div className="board-review-canvas audited-review">
            {cells.map(({ hex, left, top }) => (
              <button
                type="button"
                className="board-review-hex"
                key={hex.key}
                style={{ left: `${left}%`, top: `${top}%` }}
                aria-label={`Review cell ${hex.audit?.row}/${hex.audit?.column}: ${hex.label ?? hex.waterClass}`}
                aria-pressed={hex.key === selectedHex?.key}
                data-selected={hex.key === selectedHex?.key}
                onClick={() => setSelectedKey(hex.key)}
              ><TerrainArt hex={hex} /></button>
            ))}
            <BoardGridLines board={AUDITED_BOARD} />
            </div>
          </section>
          <div className="board-review-sources" aria-label="Reference board photographs">
            <figure className="board-review-source">
              <img
                src="/assets/board/reference-full-board.jpg"
                alt="Reference photograph of the physical Monsters Menace America board set up with its printed honeycomb spaces and pieces"
                loading="eager"
              />
              <figcaption>Full setup reference, optimized from the 2,840 × 1,752 source photograph.</figcaption>
            </figure>
            <figure className="board-review-source">
              <img
                src="/assets/board/reference-top-down-board.jpg"
                alt="Top-down reference photograph of the physical Monsters Menace America board"
                loading="eager"
              />
              <figcaption>Top-down reference for the board silhouette and printed space alignment.</figcaption>
            </figure>
          </div>
        </div>
        {selectedHex && <aside className="board-review-inspector" aria-label="Selected board cell review">
          <span className="label">SELECTED CELL</span>
          <h2>{selectedHex.audit?.row}/{selectedHex.audit?.column} · {selectedHex.label ?? selectedHex.waterClass}</h2>
          <dl>
            <div><dt>Coordinate</dt><dd>q {selectedHex.coord.q}, r {selectedHex.coord.r}</dd></div>
            <div><dt>Artwork</dt><dd>{cellArt(selectedHex.key)?.asset}</dd></div>
            <div><dt>Neighbours</dt><dd>{buildBoardIndex(AUDITED_BOARD).neighbours[selectedHex.key]?.map(key => { const a=AUDITED_BOARD.hexes[key].audit; return `${a?.row}/${a?.column}`; }).join(", ")}</dd></div>
            <div><dt>Verification</dt><dd>{selectedHex.verification}</dd></div>
            <div><dt>Water class</dt><dd>{selectedHex.waterClass}</dd></div>
            <div><dt>Features</dt><dd>{selectedHex.features.length ? selectedHex.features.map((feature) => feature.kind).join(", ") : "none authored"}</dd></div>
          </dl>
          <p>{selectedHex.sourceRefs.length ? `Source references: ${selectedHex.sourceRefs.join(", ")}` : "No source reference recorded."}</p>
          <small>Read-only inspection of the active board definition. Selecting a cell does not change a match.</small>
        </aside>}
      </div>
      <section className="dense-stack-review" aria-label="Dense piece stack rendering review">
        <div>
          <span className="label">DENSE STACK FIXTURE</span>
          <h2>One to eight occupants</h2>
          <p>Display test only. These pieces are not added to a match.</p>
        </div>
        <div className="dense-stack-fixtures">
          {Array.from({ length: 8 }, (_, index) => {
            const count = index + 1;
            return (
              <div className={`dense-stack-fixture stack-count-${count}`} data-stack-count={count} key={count} aria-label={`${count} occupant fixture`}>
                {stackFixtureAssets.slice(0, count).map((asset, pieceIndex) => <img key={`${count}-${pieceIndex}`} src={asset} alt="" aria-hidden="true" />)}
              </div>
            );
          })}
        </div>
      </section>
      <p className="board-review-count">336 audited cells · 14 rows × 24 columns · flat-top hex orientation</p>
    </main>
  );
}
