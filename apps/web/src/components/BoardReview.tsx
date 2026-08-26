import { FULL_HONEYCOMB_BOARD } from "@abominations/game-engine";
import { buildDisplayHexLayout } from "../board-layout";

type Props = { onClose: () => void };

/** Read-only geometry review; unresolved board data must never become a match. */
export function BoardReview({ onClose }: Props) {
  const cells = buildDisplayHexLayout(FULL_HONEYCOMB_BOARD);
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
      <section className="board-review-frame" aria-label="254-cell full honeycomb candidate">
        <div className="board-review-canvas">
          {cells.map(({ hex, left, top }) => (
            <div
              className="board-review-hex"
              key={hex.key}
              style={{ left: `${left}%`, top: `${top}%` }}
              role="img"
              aria-label={`Review-pending hex ${hex.key}`}
            />
          ))}
        </div>
      </section>
      <p className="board-review-count">254 candidate cells · 13 alternating rows · flat-top landscape orientation</p>
    </main>
  );
}
