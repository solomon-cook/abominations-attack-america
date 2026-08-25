export function BoardReferenceCard() {
  return (
    <figure className="card board-reference-card">
      <span className="label">BOARD REFERENCE PHOTO</span>
      <img
        src="/assets/board/full-board-top-down.webp"
        alt="Top-down photograph of the Monsters Menace America honeycomb board"
        loading="lazy"
        decoding="async"
      />
      <figcaption>
        Source reference only · the interactive board above is the pinned
        development fixture. The physical board remains source-gated until
        cell data is transcribed and signed off.
      </figcaption>
    </figure>
  );
}
