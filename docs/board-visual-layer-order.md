# Board visual layer order

The board renderer uses one fixed visual order for every board definition. This is a presentation contract only; it does not change engine legality, coordinates, or source authority.

From back to front:

1. Terrain and geography: the hex face and its land/water base artwork.
2. Features and improvements: authored site art inside the face.
3. Resources and markers: Stomp and Infamy tokens.
4. Cities and labels: the location node, name, benefit, and feature labels.
5. Pieces: monsters and military units, including selected-piece emphasis.
6. Accepted-action feedback: the confirmed movement/action path and arrival treatment.
7. Legal-action overlays: the hover/selection focus and reachable-state treatment.
8. Unavailable-board notice: the fail-closed message when a matching board definition is missing.

The current unresolved 245-cell shell intentionally renders no physical-board terrain, labels, features, or pieces. When those fields are promoted from reviewed source data, they must use these existing layer slots rather than adding a second coordinate or stacking system.

The contract is enforced by the renderer's explicit z-index declarations and the web accessibility source verifier. It should be revisited only when a new visual layer is introduced.
