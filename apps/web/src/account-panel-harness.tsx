import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AccountSummary, RoomView, SessionResponse } from "@abominations/shared";
import { AccountPanel } from "./components/AccountPanel";

const initialSession: SessionResponse = {
  token: "guest-token",
  participantId: "participant-42",
  accountLinked: false,
  room: {
    id: "room-id-42",
    code: "ROOM42",
    status: "active",
    privacy: "private",
    version: 3,
    state: {} as RoomView["state"],
    participants: [{
      id: "participant-42",
      displayName: "Guest player",
      role: "player",
      playerIndex: 0,
      connected: true,
      ready: true,
      botControlled: false,
      botAssisted: false,
    }],
    events: [],
  },
};

const replacementSession: SessionResponse = {
  ...initialSession,
  token: "replacement-guest-token",
  participantId: "participant-42",
  room: {
    ...initialSession.room,
    id: "room-id-99",
    code: "OTHER99",
    participants: [{ ...initialSession.room.participants[0]!, id: "participant-42", displayName: "Replacement guest" }],
  },
};

function AccountPanelHarness() {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const restoreSessionLater = new URLSearchParams(window.location.search).has("restore-session");
  const restoreDifferentSession = new URLSearchParams(window.location.search).has("restore-other-room");
  const [allowRoomSwitch] = useState(() => new URLSearchParams(window.location.search).has("allow-room-switch"));
  const [session, setSession] = useState<SessionResponse | null>(restoreSessionLater ? null : initialSession);
  useEffect(() => {
    if (!restoreSessionLater) return;
    const timer = window.setTimeout(() => {
      window.__accountHarnessSessionRestored = true;
      setSession(restoreDifferentSession ? replacementSession : initialSession);
    }, restoreDifferentSession ? 800 : 250);
    return () => window.clearTimeout(timer);
  }, []);
  return <main>
    {allowRoomSwitch && session && <button type="button" onClick={() => {
      window.__accountHarnessRoomSwitched = true;
      setSession(replacementSession);
    }}>Switch room session</button>}
    <output id="account-session-state" aria-label="Current room session">{JSON.stringify(session && {
      code: session.room.code,
      token: session.token,
      participantId: session.participantId,
      accountLinked: session.accountLinked,
    })}</output>
    <AccountPanel key={session ? "restored-room" : "home"} account={account} session={session} onAccountChange={setAccount} onSessionChange={setSession} />
  </main>;
}

declare global {
  interface Window {
    __accountHarnessSessionRestored?: boolean;
    __accountHarnessRoomSwitched?: boolean;
  }
}

createRoot(document.getElementById("root")!).render(<AccountPanelHarness />);
