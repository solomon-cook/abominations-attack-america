# Civ-style board reference annotation

This note records the interaction patterns used as references for the
information-dense board pass. The references inform hierarchy and disclosure,
not artwork, branding, map geometry, or rules.

## Reference patterns

| Reference | Observed pattern | Abominations application | Boundary |
| --- | --- | --- | --- |
| [Ars Technica Civ VI map reference](https://cdn.arstechnica.net/wp-content/uploads/2016/10/Civ-6-3.jpg) | The map remains the dominant surface while a compact world/turn tracker and selected-location context stay available. | Keep the honeycomb map central; retain compact `MatchStatus`, `TurnProgress`, action dock, and active-hex context beside it. | Do not copy Civ VI panels, icons, typography, or artwork. |
| [Scientific Gamer district reference](https://scientificgamer.com/blog/wp-content/uploads/2016/10/civ6_districts.jpg) | A selected tile gains visible adjacency and local detail without replacing the map. | Use canonical neighbours, legal paths, feature ownership, occupants, and selected-piece details as local context. | Adjacency and bonuses must come from the game engine; visual proximity never creates a rule edge. |
| [Millenium technology-tree reference](https://static1.millenium.org/article_old/images/contenu/actus/JeuxVideo/civilization_6/civ6_build_order_2.jpg) | Dense information is progressively disclosed through connected, compact nodes and detail views. | Use board-adjacent trays, status lightboxes, card detail, and contextual rules help instead of permanently expanding every panel. | No technology-tree rules or copied visual language are implied for this game. |
| [Steam Civ VI map reference](https://images.steamusercontent.com/ugc/18200058207178295928/F51CD7779DAA6E8A7B54AEE1A90EF01CA3E6B6B9/?ima=fit&imcolor=%23000000&impolicy=Letterbox&imw=1024&letterbox=false) | Multiple information layers coexist over a readable map: units, districts, resources, selection, and temporary feedback. | Keep the documented layer order: terrain, geography, features, markers, labels, pieces, selection, legal paths, and temporary feedback. | Physical board terrain, features, barriers, and labels remain source-gated until verified. |

## Acceptance rules

- The board must remain visible while secondary information is opened.
- A detail surface must identify whether its values are authoritative,
  provisional, or unresolved.
- The engine remains the only authority for coordinates, adjacency, legal
  actions, occupants, and outcomes.
- Original or licensed assets must be used; reference screenshots are not
  shipped as gameplay art.

The current implementation satisfies the map-dominance and progressive-
disclosure portions through `BoardContextTray`, `SelectedPieceTray`,
`PlayerStatusControls`, `PieceStackInspector`, and the on-demand details panel.
The remaining contextual adjacency states, full physical-board data, and human
visual acceptance are tracked separately in `TODO.md`.
