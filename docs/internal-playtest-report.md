# Internal development playtest report

Date: 2026-08-25  
Scope: local web development fixture at `http://127.0.0.1:5177/`  
Ruleset: development fixture only; not the promoted physical board

## Run 1 — setup through the first full turn decision chain

The run used a clean browser tab and visible controls only:

1. Start the development playtest.
2. Choose `monster-1`, then `monster-2`.
3. Choose Player 2 Army, then Player 1 Navy.
4. Choose Player 1 Los Angeles, then Player 2 Miami.
5. Choose Draw Research for both players.
6. Finish Move without moving.
7. Resolve Encounter.
8. Choose the city Health benefit.
9. Pass Deploy.

Measured automation elapsed time: 4.253 seconds. This is an automation timing, not a player-duration estimate.

## Findings

| Area | Result | Evidence / follow-up |
| --- | --- | --- |
| Ordered setup | Pass | The visible setup controls advanced through all four setup stages and reached active Move. |
| Keyboard transition | Pass | Starting local play focuses the visible current-step heading while the setup controls surface is open. |
| Move | Pass | The visible “Leave monster here & finish Move” control produced an authoritative accepted result. |
| Encounter resolution | Fixed and pass | The first run exposed a missing `encounter-resolution` action branch. `PhaseActions` now renders “Resolve encounter”; the accessibility source contract guards it. |
| Encounter choice | Pass | “Take the city Health benefit” resolved through the authoritative command path and showed the recorded reward. |
| Deploy | Pass | “Pass deployment” produced an authoritative accepted result and returned the fixture to Move. |
| Board fidelity | Blocked | The browser still renders the unresolved 254-cell candidate shell plus development overlays; no physical-board topology was promoted. |
| Full match victory | Not covered by this run | The complete browser victory path, every fight/retreat/card branch, reconnect, two-browser online flow, and mobile/assistive-technology playthrough remain separate acceptance work. |

This report is local development evidence only. It does not prove the fully filled physical board, production rules fidelity, deployment, persistence, or release readiness.
