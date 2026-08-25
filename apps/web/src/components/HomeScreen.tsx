import { LobbyPanel, type LobbyPanelProps } from "./LobbyPanel";

type Props = LobbyPanelProps & {
  rulesOpen: boolean;
  onToggleRules: () => void;
  onStartLocal: () => void;
};

export function HomeScreen({ rulesOpen, onToggleRules, onStartLocal, ...lobbyProps }: Props) {
  return (
    <main className="home-screen">
      <section className="home-hero" aria-labelledby="home-title">
        <img src="/assets/board/full-game-setup.webp" alt="Monster and military pieces arranged around the game board" />
        <div className="home-hero-copy">
          <p className="eyebrow">ABOMINATIONS ATTACK AMERICA</p>
          <h1 id="home-title">Take the city.<br />Become the legend.</h1>
          <p className="lede">A monster-versus-military strategy game about movement, compulsory battles, encounters, and one decisive final turn.</p>
          <div className="home-actions">
            <button type="button" onClick={onStartLocal}>Start development playtest</button>
            <button type="button" className="ghost" onClick={onToggleRules}>Rules</button>
          </div>
        </div>
      </section>
      <LobbyPanel {...lobbyProps} />
      {rulesOpen && (
        <section className="home-rules" aria-label="Rules reference">
          <div>
            <span className="label">QUICK RULES</span>
            <h2>One turn, four decisions</h2>
            <p>Move a monster or military unit, resolve every compulsory Fight, take the available Encounter, then Deploy or draw Research. The current step and legal actions are always shown on the board.</p>
          </div>
          <button type="button" className="ghost" onClick={onToggleRules}>Close rules</button>
        </section>
      )}
    </main>
  );
}
