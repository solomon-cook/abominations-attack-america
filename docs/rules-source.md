# Rules source and implementation boundary

## Authority and provenance

The user's physical edition is the authority for tabletop rules, printed board data, component values, and card text. If a transcription, code path, photograph, or secondary reference conflicts with that copy, record the conflict and leave it unresolved until it is checked against the physical edition. A hosted rulebook scan or player aid may help locate a question; it cannot settle a physical-source dispute or approve a rule for release.

The consolidated rules reference records a prior paraphrase attributed to `766630657-monsters-menace-america.pdf` and an extracted `.txt`; neither source file is present in this checkout. However, the checkout does contain 16 tracked, rendered English rulebook page images under `tmp/pdfs/rulebook-pages/`. They are legible enough to compare the written paraphrase and implementation with the general rules visible in those pages. The read-only comparison and concrete findings are recorded in [the checked-in page-image alignment audit](rulebook-page-alignment-audit.md). The source PDF, extraction, and a manifest proving the images' exact provenance or match to the user's physical printing are absent; page-image alignment is therefore not physical-edition verification.

The repository also contains physical component photographs and a structured catalogue derived from them. These are records from earlier inspection, not automatic verification against the user's edition. The recorded audit of `MonstersMenaceAmerica_v1.1.pdf` is a condensed secondary player aid, not a substitute for the user's rulebook, board, records, or card faces ([audit](player-aid-source-audit-2026-08-26.md)).

## Evidence and approval stages

- **Prior transcription inspection:** a cell-by-cell photo transcription, photographed component records, and a secondary player-aid review exist in the repository. These support a development candidate and help identify questions; their former labels such as `Human verified` describe that earlier inspection record only.
- **Checked-in rulebook page-image alignment:** unblocked for the claims visible in the 16 rendered pages. Record each comparison with its image page and implementation/test path. This comparison does not confirm the images' exact physical-edition provenance and does not close board, record, card, component, or release source review.
- **Physical-edition source verification:** pending. The user's copy decides disputed rules and data. Each resolved fact needs a traceable capture/reference, the comparison result, and an ambiguity record. A photo transcription or a code field named `verified` does not close this stage.
- **Playtest authorization:** the 2026-08-26 approval record authorizes the then-current implementation for a clearly labelled playtest. It does not establish physical-source parity or production readiness.
- **Release approval:** pending separate source, implementation, evidence, and human sign-off. Do not infer it from playtest authorization or a passing validator.

Use these status terms consistently:

- **Development implementation:** behavior exists in the current prototype or has a development fixture. This says nothing by itself about fidelity to the physical edition.
- **Source verified:** the rule-bearing fact has been checked against the user's physical edition, with evidence and any ambiguity recorded.
- **Release approved:** source review, implementation, required tests, and the relevant human sign-off are complete. A passing validator or a code field named `verified` is not approval.

The consolidated [rules reference](monsters-menace-america-rules.md) is the current paraphrase and interpretation record. It is not a replacement for the physical source. Deliberate digital adaptations must be called out here and must not be presented as printed rules.

## Current development state

- The regular local and room-game initializers use a 336-cell board candidate currently named `AUDITED_BOARD`. That name and its internal cell verification flags do not establish that every datum matches the user's physical edition or has release approval. The separate nine-location `DEVELOPMENT_BOARD` remains an engine fixture used by legacy and focused development scenarios; it is not the normal local/room play board.
- A multi-seat setup flow, the Move/Fight/Encounter/Deploy loop, Research and Mutation handling, and Monster Challenge behavior exist at differing levels of development implementation. The [traceability matrix](rules-traceability-matrix.md) describes code and fixture coverage; the [unresolved inventory](unresolved-rules-inventory.md) tracks source and release blockers.
- The regular local and room-game initializer currently pins `human-audited-north-america` version 1. This is the active photo-transcribed board candidate, not a physical-edition approval. The separate `FULL_HONEYCOMB_BOARD` shell and `provisional-authoritative-honeycomb-board` definition are distinct board records and must not be conflated with the active runtime board; see [board provenance reconciliation](board-source-status-reconciliation.md).
- The physical board transcription, disputed coordinates, component and card transcriptions, and rule interpretations still require review against the user's edition. Board promotion and production rules approval remain pending. Do not describe the prototype as physically verified or fully rules-faithful.

## Product requirements from the request

- Downloadable clients for iPhone/iPad, Apple TV, and computer.
- Cross-device play with friends.
- A spectator device that can join without logging in.
- Web as the first implementation target.
