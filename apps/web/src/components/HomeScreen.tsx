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
      <section className="home-hero" aria-labelledby="home-title">
        <img src="/assets/board/original-game-hero.webp" alt="Monster and military game board" />
        <div className="home-hero-copy">
          <p className="eyebrow">ABOMINATIONS ATTACK AMERICA</p>
          <h1 id="home-title">Take the city.<br />Become the legend.</h1>
          <p className="lede">A monster strategy game of cities, battles, and bad decisions.</p>
          <div className="home-actions">
            <button type="button" onClick={onStartLocal}>Start local playtest</button>
            <button type="button" className="ghost" onClick={onStartProvisionalPlaytest}>Play honeycomb board</button>
            <button type="button" className="ghost" onClick={onStartVictoryScenario}>Victory test</button>
            <button type="button" className="ghost" onClick={onOpenBoardReview}>Review full board</button>
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
            <p>Move, fight, take an Encounter, then Deploy or draw Research.</p>
          </div>
          <button type="button" className="ghost" onClick={onToggleRules}>Close rules</button>
        </section>
      )}
    </main>
  );
}
