import { LobbyPanel, type LobbyPanelProps } from "./LobbyPanel";

type Props = LobbyPanelProps & {
  rulesOpen: boolean;
  onToggleRules: () => void;
  onStartLocal: () => void;
  onStartProvisionalPlaytest: () => void;
  onOpenBoardReview: () => void;
  onStartVictoryScenario: () => void;
};

export function HomeScreen({ rulesOpen, onToggleRules, onStartLocal, onStartProvisionalPlaytest, onOpenBoardReview, onStartVictoryScenario, ...lobbyProps }: Props) {
  return (
    <main className="home-screen">
      <header className="home-masthead">
        <span className="home-wordmark">AAA</span>
        <span className="home-edition">A game of monsters & military might</span>
        <button type="button" className="home-text-button" onClick={onToggleRules} aria-expanded={rulesOpen} aria-controls="home-rules">How to play <span aria-hidden="true">↗</span></button>
      </header>
      <section className="home-intro" aria-labelledby="home-title">
        <div className="home-intro-copy">
          <p className="home-kicker">2–4 players · Turn-based strategy</p>
          <h1 id="home-title">Abominations<br /><span>attack</span><br />America.</h1>
          <p className="home-description">Pick your monster. Command your military.<br />Leave your mark on the map.</p>
          <label className="home-player-count">
            <span>Players</span>
            <select
              aria-label="Number of players"
              value={lobbyProps.playerCount}
              onChange={(event) => lobbyProps.onPlayerCountChange(Number(event.target.value) as 2 | 3 | 4)}
            >
              <option value="2">2 players</option>
              <option value="3">3 players</option>
              <option value="4">4 players</option>
            </select>
          </label>
          <button className="home-start" type="button" onClick={onStartLocal}>Start local game <span aria-hidden="true">→</span></button>
          <p className="home-local-note">One screen. Everyone at the table.</p>
        </div>
        <figure className="home-monster">
          <img src="/assets/monsters/megaclaw.webp" alt="Megaclaw, the game's giant orange clawed monster" />
          <figcaption><span>Meet the abominations</span><strong>01 / Megaclaw</strong></figcaption>
        </figure>
      </section>
      <details className="home-online" open={lobbyProps.online || Boolean(lobbyProps.roomCode) || undefined}>
        <summary><span>Playing from different cities?</span><strong>Play online <span aria-hidden="true">+</span></strong></summary>
        <LobbyPanel {...lobbyProps} />
      </details>
      {rulesOpen && (
        <section id="home-rules" className="home-rules" aria-label="Rules reference">
          <div>
            <span className="label">QUICK RULES</span>
            <h2>One turn, four decisions</h2>
            <p>Move, fight, take an Encounter, then Deploy or draw Research.</p>
          </div>
          <button type="button" className="ghost" onClick={onToggleRules}>Close rules</button>
        </section>
      )}
      <footer className="home-footer">
        <span>Abominations Attack America</span>
        <details className="home-tools">
          <summary>Playtest tools</summary>
          <div>
            <button type="button" onClick={onStartProvisionalPlaytest}>Play audited board</button>
            <button type="button" onClick={onOpenBoardReview}>Review full board</button>
            <button type="button" onClick={onStartVictoryScenario}>Victory test</button>
          </div>
        </details>
      </footer>
    </main>
  );
}
