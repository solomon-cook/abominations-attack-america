import { useState } from "react";
import { FULL_HONEYCOMB_BOARD } from "@abominations/game-engine";
import { buildDisplayHexLayout } from "../board-layout";

type Props = { onClose: () => void };

/** Read-only geometry review; unresolved board data must never become a match. */
export function BoardReview({ onClose }: Props) {
  const cells = buildDisplayHexLayout(FULL_HONEYCOMB_BOARD);
  const [selectedKey, setSelectedKey] = useState(cells[0]?.hex.key);
  const selectedHex = cells.find(({ hex }) => hex.key === selectedKey)?.hex ?? cells[0]?.hex;
  return (
    <main className="board-review-screen">
      <header className="board-review-header">
        <div>
          <p className="eyebrow">ABOMINATIONS ATTACK AMERICA · BOARD REVIEW</p>
          <h1>Full honeycomb geometry</h1>
          <p className="board-review-lede">
            Read-only review of the 254-cell candidate lattice. This is not a playable board:
            physical features, water classes, barriers, and printed labels remain source-gated.
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>Back to home</button>
      </header>
      <section className="board-review-warning" role="status">
        <strong>REVIEW TOOLING · NOT MVP PLAY</strong>
        <span>Every face is intentionally blank until the photographed board is transcribed and signed off.</span>
      </section>
      <div className="board-review-layout">
        <section className="board-review-frame" aria-label="254-cell full honeycomb candidate">
          <div className="board-review-canvas">
          {cells.map(({ hex, left, top }) => (
            <button
              type="button"
              className="board-review-hex"
              key={hex.key}
              style={{ left: `${left}%`, top: `${top}%` }}
              aria-label={`Review-pending hex ${hex.key}`}
              aria-pressed={hex.key === selectedHex?.key}
              data-selected={hex.key === selectedHex?.key}
              onClick={() => setSelectedKey(hex.key)}
            />
          ))}
          </div>
          <div className="board-review-sources" aria-label="Reference board photographs">
            <figure className="board-review-source">
              <img
                src="/assets/board/reference-full-board.jpg"
                alt="Reference photograph of the physical Monsters Menace America board set up with its printed honeycomb spaces and pieces"
                loading="lazy"
              />
              <figcaption>Full setup reference, optimized from the 2,840 × 1,752 source photograph.</figcaption>
            </figure>
            <figure className="board-review-source">
              <img
                src="/assets/board/reference-top-down-board.jpg"
                alt="Top-down reference photograph of the physical Monsters Menace America board"
                loading="lazy"
              />
              <figcaption>Top-down reference for the board silhouette and printed space alignment.</figcaption>
            </figure>
          </div>
        </section>
        {selectedHex && <aside className="board-review-inspector" aria-label="Selected board cell review">
          <span className="label">SELECTED CELL</span>
          <h2>{selectedHex.key}</h2>
          <dl>
            <div><dt>Coordinate</dt><dd>q {selectedHex.coord.q}, r {selectedHex.coord.r}</dd></div>
            <div><dt>Verification</dt><dd>{selectedHex.verification}</dd></div>
            <div><dt>Water class</dt><dd>{selectedHex.waterClass}</dd></div>
            <div><dt>Features</dt><dd>{selectedHex.features.length ? selectedHex.features.map((feature) => feature.kind).join(", ") : "none authored"}</dd></div>
          </dl>
          <p>{selectedHex.sourceRefs.length ? `Source references: ${selectedHex.sourceRefs.join(", ")}` : "No source reference recorded."}</p>
          <small>Read-only review metadata. Selecting a face does not promote it into the playable board.</small>
        </aside>}
      </div>
      <p className="board-review-count">254 candidate cells · 13 alternating rows · flat-top landscape orientation</p>
    </main>
  );
}
