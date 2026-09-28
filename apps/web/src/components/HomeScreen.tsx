import { LobbyPanel, type LobbyPanelProps } from "./LobbyPanel";
import type { ReactNode } from "react";

type Props = LobbyPanelProps & {
  rulesOpen: boolean;
  onToggleRules: () => void;
  onStartLocal: () => void;
  onStartSolo: () => void;
  onStartProvisionalPlaytest: () => void;
  onOpenBoardReview: () => void;
  onStartVictoryScenario: () => void;
  roomStartPending: boolean;
  accountPanel: ReactNode;
};

export function HomeScreen({ rulesOpen, onToggleRules, onStartLocal, onStartSolo, onStartProvisionalPlaytest, onOpenBoardReview, onStartVictoryScenario, roomStartPending, accountPanel, ...lobbyProps }: Props) {
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
              disabled={roomStartPending}
              value={lobbyProps.playerCount}
              onChange={(event) => lobbyProps.onPlayerCountChange(Number(event.target.value) as 2 | 3 | 4)}
            >
              <option value="2">2 players</option>
              <option value="3">3 players</option>
              <option value="4">4 players</option>
            </select>
          </label>
          <button className="home-start" type="button" disabled={roomStartPending} onClick={onStartLocal}>Start local game <span aria-hidden="true">→</span></button>
          <p className="home-local-note">One screen. Everyone at the table.</p>
          <button className="home-start home-start-solo" type="button" disabled={roomStartPending} onClick={onStartSolo}>Play solo vs bots <span aria-hidden="true">→</span></button>
          <p className="home-local-note">You command Player 1. The remaining seats use tactical bots.</p>
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
      {accountPanel}
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
      <footer className="home-footer">
        <span>Abominations Attack America</span>
        <details className="home-tools">
          <summary>Playtest tools</summary>
          <div>
            <button type="button" disabled={roomStartPending} onClick={onStartProvisionalPlaytest}>Play audited board</button>
            <button type="button" disabled={roomStartPending} onClick={onOpenBoardReview}>Review full board</button>
            <button type="button" disabled={roomStartPending} onClick={onStartVictoryScenario}>Victory test</button>
          </div>
        </details>
      </footer>
    </main>
  );
}
