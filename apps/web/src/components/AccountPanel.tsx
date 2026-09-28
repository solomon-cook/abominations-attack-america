import { useEffect, useRef, useState } from "react";
import type { AccountSummary, AccountGameSummary, LeaderboardCategory, LeaderboardEntry, PlayerStats, SessionResponse } from "@abominations/shared";
import {
  claimRoomSeat,
  completeAccountPasswordReset,
  deleteAccount,
  getAccount,
  getAccountGames,
  getAccountStats,
  getLeaderboard,
  getPlayerProfile,
  loginAccount,
  logoutAccount,
  registerAccount,
  requestAccountPasswordReset,
  resendAccountVerification,
  resumeAccountGame,
  updateAccountUsername,
  verifyAccountEmail,
} from "../api";

type Props = {
  account: AccountSummary | null;
  session: SessionResponse | null;
  onAccountChange: (account: AccountSummary | null) => void;
  onSessionChange: (session: SessionResponse | null) => void;
};

const categories: { value: LeaderboardCategory; label: string }[] = [
  { value: "wins", label: "Wins" },
  { value: "win-rate", label: "Win rate" },
  { value: "stomped-tiles", label: "Tiles stomped" },
  { value: "damage-taken", label: "Damage taken" },
  { value: "health-gained", label: "Health restored" },
  { value: "luck", label: "Luck" },
];

const PENDING_VERIFICATION_SEAT_KEY = "abominations-pending-verification-seat";
let accountActionSequence = 0;
let cachedVerification: { token: string; request: ReturnType<typeof verifyAccountEmail> } | null = null;

type ExpectedGuestSession = { roomCode: string; participantId: string; roomId?: string };

function expectedGuestSession(session: SessionResponse | null): ExpectedGuestSession | null {
  if (session) return { roomCode: session.room.code.toUpperCase(), participantId: session.participantId, roomId: session.room.id };
  try {
    const saved = JSON.parse(window.localStorage.getItem("abominations-session") ?? "null") as {
      participantId?: unknown;
      room?: { code?: unknown };
    } | null;
    if (typeof saved?.participantId !== "string" || typeof saved.room?.code !== "string") return null;
    return { roomCode: saved.room.code.toUpperCase(), participantId: saved.participantId };
  } catch {
    return null;
  }
}

function verifyAccountEmailOnce(token: string) {
  if (cachedVerification?.token === token) return cachedVerification.request;
  const request = verifyAccountEmail(token);
  cachedVerification = { token, request };
  return request;
}

export function AccountPanel({ account, session, onAccountChange, onSessionChange }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [username, setUsername] = useState("");
  const [lookup, setLookup] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [actionLink, setActionLink] = useState("");
  const [seatLinkPending, setSeatLinkPending] = useState(false);
  const [games, setGames] = useState<AccountGameSummary[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [boardCategory, setBoardCategory] = useState<LeaderboardCategory>("wins");
  const [publicProfile, setPublicProfile] = useState<(PlayerStats & { botAssistedMatches: number }) | null>(null);
  const gamesRequest = useRef(0);
  const accountAction = useRef(accountActionSequence);
  const currentAccountId = useRef(account?.id);
  const currentSession = useRef(session);
  currentSession.current = session;
  const verificationClaimInFlight = useRef<string | null>(null);
  const resetToken = new URLSearchParams(window.location.search).get("reset-password") ?? "";

  const beginAccountAction = () => {
    accountAction.current = ++accountActionSequence;
    return accountAction.current;
  };
  const isCurrentAccountAction = (actionId: number, accountId: string) =>
    actionId === accountAction.current && actionId === accountActionSequence && currentAccountId.current === accountId;
  const applyAccount = (nextAccount: AccountSummary | null) => {
    const previousAccountId = currentAccountId.current;
    currentAccountId.current = nextAccount?.id;
    if (previousAccountId && previousAccountId !== nextAccount?.id) {
      try {
        const pending = window.sessionStorage.getItem(PENDING_VERIFICATION_SEAT_KEY);
        if (pending && (JSON.parse(pending) as { accountId?: unknown }).accountId === previousAccountId) {
          window.sessionStorage.removeItem(PENDING_VERIFICATION_SEAT_KEY);
        }
      } catch {
        // A stale marker is harmless when session storage cannot be read.
      }
    }
    onAccountChange(nextAccount);
  };

  useEffect(() => {
    let live = true;
    const verifyToken = new URLSearchParams(window.location.search).get("verify-email");
    if (verifyToken) {
      const actionId = beginAccountAction();
      void verifyAccountEmailOnce(verifyToken).then((result) => {
        if (actionId !== accountAction.current || actionId !== accountActionSequence) return;
        applyAccount(result.account);
        if (live) setMessage(result.message);
        try {
          const expectedSession = expectedGuestSession(session);
          if (expectedSession) window.sessionStorage.setItem(PENDING_VERIFICATION_SEAT_KEY, JSON.stringify({ accountId: result.account.id, ...expectedSession }));
          else window.sessionStorage.removeItem(PENDING_VERIFICATION_SEAT_KEY);
        } catch {
          // The user can still link the seat manually if session storage is unavailable.
        }
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
      }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : "Email verification failed."); });
    } else {
      const actionId = accountAction.current;
      void getAccount().then(({ account: current }) => {
        if (live && actionId === accountAction.current) applyAccount(current);
      }).catch(() => { if (live && actionId === accountAction.current) applyAccount(null); });
    }
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!account) { gamesRequest.current += 1; setGames([]); setStats(null); return; }
    let live = true;
    const requestId = ++gamesRequest.current;
    void Promise.all([getAccountGames(), getAccountStats()]).then(([matches, currentStats]) => {
      if (!live || requestId !== gamesRequest.current) return;
      setGames(matches);
      setStats(currentStats);
    }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : "Could not load account data."); });
    return () => { live = false; };
  }, [account?.id]);

  useEffect(() => {
    void getLeaderboard(boardCategory).then(setBoard).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load leaderboard."));
  }, [boardCategory]);

  const run = async (action: () => Promise<void>) => {
    setError(""); setMessage(""); setActionLink("");
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Account request failed."); }
  };
  const refreshGames = async () => {
    const requestId = ++gamesRequest.current;
    const matches = await getAccountGames();
    if (requestId === gamesRequest.current) setGames(matches);
    return matches;
  };

  useEffect(() => {
    let live = true;
    let pending: { accountId?: unknown; roomCode?: unknown; participantId?: unknown; roomId?: unknown } | null = null;
    try {
      const stored = window.sessionStorage.getItem(PENDING_VERIFICATION_SEAT_KEY);
      if (stored) pending = JSON.parse(stored) as { accountId?: unknown };
    } catch {
      return () => { live = false; };
    }
    if (!pending || typeof pending.accountId !== "string" || !session) return () => { live = false; };
    const matchesExpectedSession = typeof pending.roomCode === "string"
      && pending.roomCode.toUpperCase() === session.room.code.toUpperCase()
      && typeof pending.participantId === "string"
      && pending.participantId === session.participantId
      && (typeof pending.roomId !== "string" || pending.roomId === session.room.id);
    if (!matchesExpectedSession) {
      window.sessionStorage.removeItem(PENDING_VERIFICATION_SEAT_KEY);
      return () => { live = false; };
    }
    if (account?.id !== pending.accountId) return () => { live = false; };
    const accountId = pending.accountId;
    const expectedSession = session;
    const currentSeat = expectedSession.room.participants.find((seat) => seat.id === expectedSession.participantId);
    if (currentSeat?.role !== "player" || currentSeat.playerIndex === undefined) {
      window.sessionStorage.removeItem(PENDING_VERIFICATION_SEAT_KEY);
      return () => { live = false; };
    }
    const actionId = accountAction.current;
    const claimKey = `${accountId}:${expectedSession.room.id}:${expectedSession.participantId}:${expectedSession.token}`;
    if (verificationClaimInFlight.current === claimKey) return () => { live = false; };
    const isCurrentFlow = () => {
      const activeSession = currentSession.current;
      return live
        && isCurrentAccountAction(actionId, accountId)
        && activeSession?.participantId === expectedSession.participantId
        && activeSession.room.id === expectedSession.room.id
        && activeSession.room.code.toUpperCase() === expectedSession.room.code.toUpperCase()
        && activeSession.token === expectedSession.token;
    };
    verificationClaimInFlight.current = claimKey;
    void (async () => {
      try {
        const matches = await refreshGames();
        if (!isCurrentFlow()) return;
        const alreadyLinked = matches.some((game) => game.roomId === expectedSession.room.id && game.playerIndex === currentSeat.playerIndex);
        if (!alreadyLinked) {
          const claimed = await claimRoomSeat(expectedSession.room.code, expectedSession.token);
          if (!isCurrentFlow()) return;
          window.sessionStorage.removeItem(PENDING_VERIFICATION_SEAT_KEY);
          if (live && isCurrentAccountAction(actionId, accountId)) setMessage("This match is linked to your account.");
          onSessionChange(claimed);
          if (claimed.accountLinked) {
            void refreshGames().catch((caught: unknown) => {
              if (isCurrentAccountAction(actionId, accountId)) setError(caught instanceof Error ? caught.message : "Could not refresh linked matches.");
            });
          }
          return;
        }
        if (isCurrentFlow()) window.sessionStorage.removeItem(PENDING_VERIFICATION_SEAT_KEY);
      } catch (caught) {
        if (isCurrentFlow()) {
          window.sessionStorage.removeItem(PENDING_VERIFICATION_SEAT_KEY);
          setError(caught instanceof Error ? caught.message : "Could not link the verified account to this match.");
        }
      } finally {
        if (verificationClaimInFlight.current === claimKey) verificationClaimInFlight.current = null;
      }
    })();
    return () => { live = false; };
  }, [account?.id, session?.participantId, session?.room.code, session?.room.id, session?.token]);

  const claimCurrentSeat = async (nextAccount: AccountSummary) => {
    const actionId = accountAction.current;
    const currentSeat = session?.room.participants.find((seat) => seat.id === session.participantId);
    if (session?.room && currentSeat?.role === "player" && currentSeat.playerIndex !== undefined) {
      const matches = await refreshGames();
      if (!isCurrentAccountAction(actionId, nextAccount.id)) return;
      const alreadyLinked = matches.some((game) => game.roomId === session.room.id && game.playerIndex === currentSeat.playerIndex);
      if (alreadyLinked) return;
      const claimed = await claimRoomSeat(session.room.code, session.token);
      if (!isCurrentAccountAction(actionId, nextAccount.id)) return;
      onSessionChange(claimed);
      if (claimed.accountLinked) await refreshGames();
    }
  };
  const linkSeat = async () => {
    if (!session || seatLinkPending) return;
    setSeatLinkPending(true);
    try {
      const actionId = accountAction.current;
      const accountId = account?.id;
      if (!accountId) return;
      const currentSeat = session.room.participants.find((seat) => seat.id === session.participantId);
      const matches = await refreshGames();
      if (!isCurrentAccountAction(actionId, accountId)) return;
      if (currentSeat?.playerIndex !== undefined && matches.some((game) => game.roomId === session.room.id && game.playerIndex === currentSeat.playerIndex)) {
        setMessage("This match is already linked to your account.");
        return;
      }
      const claimed = await claimRoomSeat(session.room.code, session.token);
      if (!isCurrentAccountAction(actionId, accountId)) return;
      onSessionChange(claimed);
      if (claimed.accountLinked) await refreshGames();
      setMessage("This match is linked to your account.");
    } finally {
      setSeatLinkPending(false);
    }
  };
  const currentSeat = session?.room.participants.find((seat) => seat.id === session.participantId);
  const currentSeatAlreadyLinked = Boolean(account && session && currentSeat?.playerIndex !== undefined && games.some((game) => game.roomId === session.room.id && game.playerIndex === currentSeat.playerIndex));

  return (
    <details className="account-panel" onKeyDown={(event) => {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.preventDefault();
      event.stopPropagation();
      const panel = event.currentTarget;
      panel.open = false;
      panel.querySelector<HTMLElement>(":scope > summary")?.focus({ preventScroll: true });
    }}>
      <summary><span>PLAYER ACCOUNT</span><strong>{account ? `@${account.username}` : "Sign in · save matches and stats"}</strong></summary>
      <div className="account-panel-content">
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="account-message" role="status">{message}</p>}
        {!account ? <>
          <div className="account-mode-tabs"><button type="button" className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>Sign in</button><button type="button" className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>Create account</button></div>
          <p className="account-private-note">Your public username is separate from your private email and password.</p>
          <form className="account-form" onSubmit={(event) => { event.preventDefault(); void run(async () => {
            if (mode === "register") {
              const result = await registerAccount(email, password);
              setMessage(result.message);
              if (result.developmentLink) setActionLink(result.developmentLink);
            } else {
              const actionId = beginAccountAction();
              const result = await loginAccount(email, password);
              if (actionId !== accountAction.current || actionId !== accountActionSequence) return;
              applyAccount(result.account);
              await claimCurrentSeat(result.account);
              setMessage(result.message);
            }
          }); }}>
            <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button type="submit">{mode === "register" ? "Create account" : "Sign in"}</button>
          </form>
          <div className="account-secondary-actions">
            <button type="button" onClick={() => void run(async () => { const result = await resendAccountVerification(email); setMessage(result.message); if (result.developmentLink) setActionLink(result.developmentLink); })}>Resend verification</button>
            <button type="button" onClick={() => void run(async () => { const result = await requestAccountPasswordReset(email); setMessage(result.message); if (result.developmentLink) setActionLink(result.developmentLink); })}>Reset password</button>
          </div>
          {actionLink && <a className="account-action-link" href={actionLink}>Continue with account link</a>}
          {resetToken && <form className="account-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await completeAccountPasswordReset(resetToken, newPassword); setMessage(result.message); }); }}><label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><button type="submit">Set new password</button></form>}
        </> : <>
          <div className="account-identity"><span>Public username</span><strong>@{account.username}</strong><span>{account.emailVerified ? "Email verified" : "Email verification required"}</span></div>
          {!currentSeatAlreadyLinked && currentSeat?.role === "player" && <button type="button" className="account-link-seat" disabled={seatLinkPending} onClick={() => void run(linkSeat)}>{seatLinkPending ? "Linking player seat…" : "Link current player seat"}</button>}
          <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await updateAccountUsername(username || account.username); applyAccount(result.account); setUsername(""); setMessage("Username updated."); }); }}><label>Change username<input minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]+" value={username} placeholder={account.username} onChange={(event) => setUsername(event.target.value)} /></label><button type="submit">Save</button></form>
          {stats && <div className="account-stats"><span><strong>{stats.gamesPlayed}</strong> games</span><span><strong>{stats.wins}</strong> wins</span><span><strong>{Math.round(stats.winRate * 100)}%</strong> win rate</span><span><strong>{stats.stompedTiles}</strong> tiles stomped</span><span><strong>{stats.damageTaken}</strong> damage taken</span><span><strong>{stats.healthGained}</strong> Health restored</span><span><strong>{stats.luckAverage === null ? "—" : stats.luckAverage.toFixed(2)}</strong> luck</span></div>}
          {stats && <p className="account-choices">Most chosen: {stats.mostChosenMonster ?? "no monster"} · {stats.mostChosenBranch ?? "no branch"}</p>}
          <section className="account-matches"><h3>Your online matches</h3>{games.length ? games.map((game) => <div className="account-match" key={`${game.roomId}-${game.playerIndex}`}><span><strong>{game.code}</strong> · {game.status}{game.botAssisted ? " · bot assisted" : ""}</span>{game.status !== "completed" && game.status !== "expired" && <button type="button" onClick={() => void run(async () => { onSessionChange(await resumeAccountGame(game.roomId)); setMessage(`Resumed match ${game.code}.`); })}>Resume</button>}</div>) : <p>No account-linked matches yet.</p>}</section>
          <button className="account-signout" type="button" onClick={() => void run(async () => { const actionId = beginAccountAction(); await logoutAccount(); if (actionId !== accountAction.current) return; applyAccount(null); setMessage("Signed out."); })}>Sign out</button>
          <button className="account-delete" type="button" onClick={() => { if (window.confirm("Delete your account? Your public profile and stats will be removed. Shared match history will remain anonymized.")) void run(async () => { const actionId = beginAccountAction(); await deleteAccount(); if (actionId !== accountAction.current) return; applyAccount(null); onSessionChange(null); setMessage("Account deleted."); }); }}>Delete account</button>
        </>}
        <section className="account-leaderboard"><h3>Public rankings</h3><select aria-label="Leaderboard category" value={boardCategory} onChange={(event) => setBoardCategory(event.target.value as LeaderboardCategory)}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>{board.slice(0, 10).map((entry) => <div className="leaderboard-row" key={entry.username}><span>{entry.rank}. <button className="leaderboard-profile-button" type="button" onClick={() => void run(async () => { setLookup(entry.username); setPublicProfile(await getPlayerProfile(entry.username)); })}>@{entry.username}</button></span><strong>{boardCategory === "win-rate" ? `${(entry.value * 100).toFixed(1)}%` : boardCategory === "luck" ? entry.value.toFixed(2) : entry.value}</strong></div>)}</section>
        <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void run(async () => setPublicProfile(await getPlayerProfile(lookup))); }}><label>View public profile<input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="player username" /></label><button type="submit">View</button></form>
        {publicProfile && <div className="account-public-profile"><strong>@{publicProfile.username}</strong><span>{publicProfile.wins} wins · {publicProfile.losses} losses · {publicProfile.ties} ties · {Math.round(publicProfile.winRate * 100)}% win rate</span><span>Most chosen: {publicProfile.mostChosenMonster ?? "—"} · {publicProfile.mostChosenBranch ?? "—"}</span><span>{publicProfile.botAssistedMatches} bot-assisted results</span></div>}
      </div>
    </details>
  );
}
