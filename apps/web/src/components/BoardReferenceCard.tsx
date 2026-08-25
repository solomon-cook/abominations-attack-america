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
        Source reference only · the interactive shell above is the current
        shared board candidate.
      </figcaption>
    </figure>
  );
}
