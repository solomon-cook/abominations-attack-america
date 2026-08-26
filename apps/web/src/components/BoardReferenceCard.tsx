export function BoardReferenceCard() {
  return (
    <figure className="card board-reference-card">
      <span className="label">BOARD SOURCE STATUS</span>
      <p className="board-reference-status">The physical board is source-gated. The interactive board above uses only the pinned development fixture until every physical hex, feature, barrier, and edge is transcribed and signed off.</p>
      <figcaption>
        Reference photographs are retained for internal review only and are not
        shipped in the playable web client.
      </figcaption>
    </figure>
  );
}
