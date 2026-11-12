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

type MenuPanel = "home" | "play" | "solo" | "multiplayer" | "settings" | "rules" | "manual";

export function HomeScreen({ rulesOpen, onToggleRules, onStartLocal, onStartSolo, onStartSoloScenario, botDifficulty, onBotDifficultyChange, onStartProvisionalPlaytest, onOpenBoardReview, onStartVictoryScenario, accountPanel, ...lobbyProps }: Props) {
  const [panel, setPanel] = useState<MenuPanel>(rulesOpen ? "rules" : "home");

  const openPanel = (next: MenuPanel) => {
    setPanel(next);
    if (next === "rules" && !rulesOpen) onToggleRules();
    if (panel === "rules" && next !== "rules" && rulesOpen) onToggleRules();
  };

  return (
    <main className="home-screen">
      <div className="home-backdrop" aria-hidden="true" />
      <div className="home-frame">
        <header className="home-masthead">
          <span className="home-wordmark">MMA</span>
          <span className="home-edition">Monsters Menace America</span>
          {panel !== "home" && <button type="button" className="home-text-button" onClick={() => openPanel("home")}>Main menu</button>}
        </header>

        <section className="home-intro" aria-labelledby="home-title">
          <div className="home-intro-copy">
            <p className="home-kicker">2–4 players · Turn-based strategy</p>
            <h1 id="home-title">Monsters<br /><span>Menace</span><br />America</h1>
            <div className="home-menu-panel" aria-live="polite">
              <div className="home-menu-scroll">
                {panel === "home" && <nav className="home-primary-menu" aria-label="Main menu">
                  <button type="button" className="home-menu-button home-menu-button-primary" onClick={() => openPanel("play")}>Play <span aria-hidden="true">→</span></button>
                  <button type="button" className="home-menu-button" onClick={() => openPanel("settings")}>Settings / Account <span aria-hidden="true">→</span></button>
                </nav>}

                {panel === "play" && <section aria-labelledby="play-menu-title">
                  <h2 id="play-menu-title">Play</h2>
                  <div className="home-submenu-options">
                    <button type="button" className="home-mode-choice" onClick={() => openPanel("solo")}><strong>Single player</strong><span>Play solo or on one screen</span></button>
                    <button type="button" className="home-mode-choice" onClick={() => openPanel("multiplayer")}><strong>Multiplayer</strong><span>Play with others online</span></button>
                  </div>
                </section>}

                {panel === "solo" && <section aria-labelledby="solo-menu-title">
                  <h2 id="solo-menu-title">Single player</h2>
                  <button type="button" className="home-back" onClick={() => openPanel("play")}>← Back</button>
                  <div className="home-submenu-options">
                    <label className="home-bot-difficulty"><span>Bot difficulty</span><select aria-label="Bot difficulty" value={botDifficulty} onChange={(event) => onBotDifficultyChange(event.target.value as BotDifficulty)}><option value="casual">Casual</option><option value="standard">Tactical</option><option value="challenging">Challenging</option></select></label>
                    <button className="home-start" type="button" onClick={onStartSolo}>Play solo vs bots <span aria-hidden="true">→</span></button>
                    <button className="home-start home-start-solo" type="button" onClick={onStartSoloScenario}>Guided first-turn scenario <span aria-hidden="true">→</span></button>
                    <label className="home-player-count"><span>Players at the table</span><select aria-label="Number of players" value={lobbyProps.playerCount} onChange={(event) => lobbyProps.onPlayerCountChange(Number(event.target.value) as 2 | 3 | 4)}><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select></label>
                    <button className="home-start home-start-solo" type="button" onClick={onStartLocal}>Play on one screen <span aria-hidden="true">→</span></button>
                  </div>
                </section>}

                {panel === "multiplayer" && <section aria-labelledby="multiplayer-menu-title">
                  <h2 id="multiplayer-menu-title">Multiplayer</h2>
                  <button type="button" className="home-back" onClick={() => openPanel("play")}>← Back</button>
                  <LobbyPanel {...lobbyProps} />
                </section>}

                {panel === "settings" && <section aria-labelledby="settings-menu-title">
                  <h2 id="settings-menu-title">Settings / Account</h2>
                  <label className="home-player-count"><span>Players at the table</span><select aria-label="Number of players" value={lobbyProps.playerCount} onChange={(event) => lobbyProps.onPlayerCountChange(Number(event.target.value) as 2 | 3 | 4)}><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select></label>
                  <label className="home-bot-difficulty"><span>Bot difficulty</span><select aria-label="Bot difficulty" value={botDifficulty} onChange={(event) => onBotDifficultyChange(event.target.value as BotDifficulty)}><option value="casual">Casual</option><option value="standard">Tactical</option><option value="challenging">Challenging</option></select></label>
                  <div className="home-auth-choice">
                    <button type="button" className="home-guest-button" onClick={() => setPanel("home")}>Continue as guest</button>
                    <p className="home-local-note">Account</p>
                    <div className="home-account-form"><p className="account-private-note">Account sign-in is not available in this Preview. You can continue as a guest.</p>{cloneElement(accountPanel as ReactElement<{ defaultOpen?: boolean; compact?: boolean; deferAccountRequests?: boolean }>, { defaultOpen: true, compact: true, deferAccountRequests: true })}</div>
                  </div>
                  <div className="home-settings-links">
                    <button type="button" className="home-menu-button" onClick={() => openPanel("rules")}>How to play <span aria-hidden="true">→</span></button>
                    <button type="button" className="home-menu-button" onClick={() => openPanel("manual")}>Field manual <span aria-hidden="true">→</span></button>
                  </div>
                </section>}

                {panel === "rules" && <section id="home-rules" aria-label="Rules reference">
                  <h2>Quick rules</h2>
                  <p>One turn, four decisions</p>
                  <p>Move, fight, take an Encounter, then Deploy or draw Research.</p>
                  <RulesChallenge />
                </section>}

                {panel === "manual" && <section aria-labelledby="manual-title">
                  <h2 id="manual-title">Field manual</h2>
                  <p>Monster and military tactics</p>
                  <div className="solo-strategy-content">
                    <p>Use terrain and timing to make the monster choose between a safer route, a fight, and a Military Research draw.</p>
                    <div className="strategy-columns">
                      <section><h3>Monster playbooks</h3>
                        <article><strong>Konk</strong><p>Use its speed to stomp cities and reach exposed units. Keep moving when a blocker would force a costly fight.</p></article>
                        <article><strong>Zorb</strong><p>Build Infamy through city pressure, then spend it to add attacks. Avoid standing beside a concentrated force before you are ready.</p></article>
                        <article><strong>Megaclaw</strong><p>Lean on its attack strength to break isolated screens. Route around massed high defense unless the objective is worth the exchange.</p></article>
                        <article><strong>Gargantis</strong><p>Preserve Mutation cards as healing reserves; use its healing ability when damage threatens a challenge or another turn.</p></article>
                        <article><strong>Toxicor</strong><p>Exploit its high mobility and mutation pressure. Cruise missiles and Antimatter make military attacks riskier for the attacker.</p></article>
                        <article><strong>Tomanagi</strong><p>Use its balanced profile to contest central objectives. Draw Research or recover rather than feed a prepared firing line.</p></article>
                      </section>
                      <section><h3>Military branch orders</h3>
                        <article><strong>Army</strong><p>Put durable tanks on the monster’s likely route, then bring missile launchers to the same hex. Against Konk, screen the next city instead of chasing its speed; against Megaclaw, only commit a concentrated force; against Gargantis, focus fire before it can heal.</p></article>
                        <article><strong>Navy</strong><p>Use fighters to close gaps and keep submarines in launch range. Concentrate a submarine strike with nearby units against wounded Zorb or Tomanagi; preserve the missile attack against Toxicor, whose mutation can turn a strike into a liability.</p></article>
                        <article><strong>Air Force</strong><p>Concentrate fighters for a reliable attack and reserve cruise missiles for a high value target. Against Megaclaw, attack en masse; against Toxicor, avoid feeding missile mutations; against Tomanagi, draw Research when a counter card is more useful than a scattered deployment.</p></article>
                        <article><strong>Marines</strong><p>Stack rocket launchers for their heavier hits and use fighters to reach the engagement. Block Zorb before it collects more Infamy, screen Konk’s route, and attack Megaclaw only with enough units to absorb its return attacks.</p></article>
                      </section>
                    </div>
                    <p className="strategy-note"><strong>Matchup rule:</strong> block movement when a monster is one space from a valuable city or lair; attack en masse when your combined force can survive its return attacks; otherwise reposition or draw Research to improve the next engagement.</p>
                  </div>
                  <details className="home-tools">
                    <summary>Playtest tools</summary>
                    <div>
                      <button type="button" onClick={onStartProvisionalPlaytest}>Play audited board</button>
                      <button type="button" onClick={onOpenBoardReview}>Review full board</button>
                      <button type="button" onClick={onStartVictoryScenario}>Victory test</button>
                    </div>
                  </details>
                </section>}
              </div>
              <footer className="home-menu-footer">
                <span>Monsters Menace America</span>
                {panel !== "home" && <button type="button" onClick={() => openPanel("home")}>Main menu</button>}
              </footer>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
