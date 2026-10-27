import { cloneElement, useState, type ReactElement, type ReactNode } from "react";
import { LobbyPanel, type LobbyPanelProps } from "./LobbyPanel";
import type { BotDifficulty } from "../solo-bots";
import { RulesChallenge } from "./RulesChallenge";

type Props = LobbyPanelProps & {
  rulesOpen: boolean;
  onToggleRules: () => void;
  onStartLocal: () => void;
  onStartSolo: () => void;
  onStartSoloScenario: () => void;
  botDifficulty: BotDifficulty;
  onBotDifficultyChange: (difficulty: BotDifficulty) => void;
  onStartProvisionalPlaytest: () => void;
  onOpenBoardReview: () => void;
  onStartVictoryScenario: () => void;
  accountPanel: ReactNode;
};

export function HomeScreen({ rulesOpen, onToggleRules, onStartLocal, onStartSolo, onStartSoloScenario, botDifficulty, onBotDifficultyChange, onStartProvisionalPlaytest, onOpenBoardReview, onStartVictoryScenario, accountPanel, ...lobbyProps }: Props) {
  const [mode, setMode] = useState<"single" | "multiplayer" | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
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
          <p className="home-description">Choose how you want to play.</p>
          <section className="home-start-panel" aria-label="Choose how to play">
            <h2>{mode ? (mode === "single" ? "Single player" : "Multiplayer") : "How do you want to play?"}</h2>
            {!mode ? <div className="home-mode-options">
              <button type="button" className="home-mode-choice" onClick={() => setMode("single")}><strong>Single player</strong><span>Play alone or pass the screen around</span></button>
              <button type="button" className="home-mode-choice" onClick={() => setMode("multiplayer")}><strong>Multiplayer</strong><span>Play together or from different places</span></button>
            </div> : <>
              <button type="button" className="home-back" onClick={() => setMode(null)}>← Back</button>
              {mode === "single" ? <div className="home-mode-options">
                <label className="home-bot-difficulty"><span>Bot difficulty</span><select aria-label="Bot difficulty" value={botDifficulty} onChange={(event) => onBotDifficultyChange(event.target.value as BotDifficulty)}><option value="casual">Casual</option><option value="standard">Tactical</option><option value="challenging">Challenging</option></select></label>
                <button className="home-start" type="button" onClick={onStartSolo}>Play solo vs bots <span aria-hidden="true">→</span></button>
                <button className="home-start home-start-solo" type="button" onClick={onStartSoloScenario}>Guided first-turn scenario <span aria-hidden="true">→</span></button>
                <label className="home-player-count"><span>Players at the table</span><select aria-label="Number of players" value={lobbyProps.playerCount} onChange={(event) => lobbyProps.onPlayerCountChange(Number(event.target.value) as 2 | 3 | 4)}><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select></label>
                <button className="home-start home-start-solo" type="button" onClick={onStartLocal}>Play on one screen <span aria-hidden="true">→</span></button>
              </div> : <LobbyPanel {...lobbyProps} />}
            </>}
            <div className="home-auth-choice">
              <span>Account</span>
              <button type="button" onClick={() => setAccountOpen((open) => !open)}>{accountOpen ? "Hide sign in" : "Sign in"}</button>
              <button type="button" className="home-guest-button" onClick={() => setAccountOpen(false)}>Continue as guest</button>
            </div>
            {accountOpen && <div className="home-account-form"><p className="account-private-note">Account sign-in is not available in this Preview yet. You can continue as a guest.</p>{cloneElement(accountPanel as ReactElement<{ defaultOpen?: boolean; compact?: boolean; deferAccountRequests?: boolean }>, { defaultOpen: true, compact: true, deferAccountRequests: true })}</div>}
          </section>
        </div>
      </section>
      {lobbyProps.online && <LobbyPanel {...lobbyProps} />}
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
      <details className="home-extras">
        <summary>Guides and practice</summary>
        <div className="home-extras-content">
          <RulesChallenge />
          <details className="solo-strategy-guide">
            <summary><span>FIELD MANUAL</span><strong>Monster and military tactics <span aria-hidden="true">+</span></strong></summary>
            <div className="solo-strategy-content">
              <p>Use terrain and timing to make the monster choose between a safer route, a fight, and a Military Research draw.</p>
              <div className="strategy-columns">
                <section><h2>Monster playbooks</h2>
                  <article><strong>Konk</strong><p>Use its speed to stomp cities and reach exposed units. Keep moving when a blocker would force a costly fight.</p></article>
                  <article><strong>Zorb</strong><p>Build Infamy through city pressure, then spend it to add attacks. Avoid standing beside a concentrated force before you are ready.</p></article>
                  <article><strong>Megaclaw</strong><p>Lean on its attack strength to break isolated screens. Route around massed high defense unless the objective is worth the exchange.</p></article>
                  <article><strong>Gargantis</strong><p>Preserve Mutation cards as healing reserves; use its healing ability when damage threatens a challenge or another turn.</p></article>
                  <article><strong>Toxicor</strong><p>Exploit its high mobility and mutation pressure. Cruise missiles and Antimatter make military attacks riskier for the attacker.</p></article>
                  <article><strong>Tomanagi</strong><p>Use its balanced profile to contest central objectives. Draw Research or recover rather than feed a prepared firing line.</p></article>
                </section>
                <section><h2>Military branch orders</h2>
                  <article><strong>Army · block and hold</strong><p>Put durable tanks on the monster’s likely route, then bring missile launchers to the same hex. Against Konk, screen the next city instead of chasing its speed; against Megaclaw, only commit a concentrated force; against Gargantis, focus fire before it can heal.</p></article>
                  <article><strong>Navy · reach and punish</strong><p>Use fighters to close gaps and keep submarines in launch range. Concentrate a submarine strike with nearby units against wounded Zorb or Tomanagi; preserve the missile attack against Toxicor, whose mutation can turn a strike into a liability.</p></article>
                  <article><strong>Air Force · mass and research</strong><p>Concentrate fighters for a reliable attack and reserve cruise missiles for a high value target. Against Megaclaw, attack en masse; against Toxicor, avoid feeding missile mutations; against Tomanagi, draw Research when a counter card is more useful than a scattered deployment.</p></article>
                  <article><strong>Marines · decisive volley</strong><p>Stack rocket launchers for their heavier hits and use fighters to reach the engagement. Block Zorb before it collects more Infamy, screen Konk’s route, and attack Megaclaw only with enough units to absorb its return attacks.</p></article>
                </section>
              </div>
              <p className="strategy-note"><strong>Matchup rule:</strong> block movement when a monster is one space from a valuable city or lair; attack en masse when your combined force can survive its return attacks; otherwise reposition or draw Research to improve the next engagement.</p>
            </div>
          </details>
          <details className="home-tools">
            <summary>Playtest tools</summary>
            <div>
              <button type="button" onClick={onStartProvisionalPlaytest}>Play audited board</button>
              <button type="button" onClick={onOpenBoardReview}>Review full board</button>
              <button type="button" onClick={onStartVictoryScenario}>Victory test</button>
            </div>
          </details>
        </div>
      </details>
      <footer className="home-footer">
        <span>Abominations Attack America</span>
      </footer>
    </main>
  );
}
