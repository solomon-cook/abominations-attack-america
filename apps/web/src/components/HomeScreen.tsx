import { cloneElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { LobbyPanel, type LobbyPanelProps } from "./LobbyPanel";
import type { BotDifficulty } from "../solo-bots";
import type { AccountSummary } from "@abominations/shared";

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

type MenuPanel = "auth" | "home" | "solo" | "multiplayer";

export function HomeScreen({ rulesOpen, onToggleRules, onStartLocal, onStartSolo, onStartSoloScenario, botDifficulty, onBotDifficultyChange, onStartProvisionalPlaytest, onOpenBoardReview, onStartVictoryScenario, accountPanel, ...lobbyProps }: Props) {
  const [panel, setPanel] = useState<MenuPanel>("auth");
  const [qrJoinRequested, setQrJoinRequested] = useState(false);
  void rulesOpen; void onToggleRules; void onStartSoloScenario; void onStartProvisionalPlaytest; void onOpenBoardReview; void onStartVictoryScenario;

  useEffect(() => {
    if (!qrJoinRequested) return;
    setQrJoinRequested(false);
    setPanel("multiplayer");
    lobbyProps.onStartSession("join");
  }, [qrJoinRequested, lobbyProps.onStartSession]);

  const openPanel = (next: MenuPanel) => {
    setPanel(next);
  };

  return (
    <main className="home-screen">
      <div className="home-backdrop" aria-hidden="true" />
      <div className="home-frame">
        <header className="home-masthead">
          <span className="home-wordmark" aria-hidden="true">AAA</span>
          {panel !== "home" && panel !== "auth" && <button type="button" className="home-text-button" onClick={() => openPanel("home")}>Main menu</button>}
        </header>

        <section className="home-intro" aria-labelledby="home-title">
          <div className="home-intro-copy">
            <h1 id="home-title">Monsters<br /><span>Menace</span><br />America</h1>
            <div className="home-menu-panel" aria-live="polite">
              <div className="home-menu-scroll">
                {panel === "auth" && <section aria-labelledby="auth-menu-title">
                  <h2 id="auth-menu-title">Sign in to continue</h2>
                  <div className="home-account-form">{cloneElement(accountPanel as ReactElement<{ defaultOpen?: boolean; compact?: boolean; deferAccountRequests?: boolean; onAccountChange?: (account: AccountSummary | null) => void }>, { defaultOpen: true, compact: true, deferAccountRequests: true, onAccountChange: (nextAccount: AccountSummary | null) => { const original = (accountPanel as ReactElement<{ onAccountChange?: (account: AccountSummary | null) => void }>).props.onAccountChange; original?.(nextAccount); if (nextAccount) { if (new URLSearchParams(window.location.search).get("qr") === "1" && lobbyProps.roomCode) setQrJoinRequested(true); else setPanel("home"); } } })}</div>
                </section>}

                {panel === "home" && <nav className="home-primary-menu" aria-label="Main menu">
                  <h2>Choose how to play</h2>
                  <button type="button" className="home-menu-button home-menu-button-primary" onClick={() => openPanel("solo")}>Single player <span aria-hidden="true">→</span></button>
                  <button type="button" className="home-menu-button" onClick={() => openPanel("multiplayer")}>Multiplayer <span aria-hidden="true">→</span></button>
                </nav>}

                {panel === "solo" && <section aria-labelledby="solo-menu-title">
                  <h2 id="solo-menu-title">Single player</h2>
                  <button type="button" className="home-back" onClick={() => openPanel("home")}>← Back</button>
                  <div className="home-submenu-options">
                    <label className="home-bot-difficulty"><span>Bot difficulty</span><select aria-label="Bot difficulty" value={botDifficulty} onChange={(event) => onBotDifficultyChange(event.target.value as BotDifficulty)}><option value="casual">Casual</option><option value="standard">Tactical</option><option value="challenging">Challenging</option></select></label>
                    <button className="home-start" type="button" onClick={onStartSolo}>Play solo vs bots <span aria-hidden="true">→</span></button>
                    <button className="home-start home-start-solo" type="button" onClick={onStartLocal}>Play on one screen <span aria-hidden="true">→</span></button>
                  </div>
                </section>}

                {panel === "multiplayer" && <section aria-labelledby="multiplayer-menu-title">
                  <h2 id="multiplayer-menu-title">Multiplayer</h2>
                  <button type="button" className="home-back" onClick={() => openPanel("home")}>← Back</button>
                  <LobbyPanel {...lobbyProps} />
                </section>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
