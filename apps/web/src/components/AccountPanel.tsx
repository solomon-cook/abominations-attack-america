import { useEffect, useState } from "react";
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
  const [games, setGames] = useState<AccountGameSummary[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [boardCategory, setBoardCategory] = useState<LeaderboardCategory>("wins");
  const [publicProfile, setPublicProfile] = useState<(PlayerStats & { botAssistedMatches: number }) | null>(null);
  const resetToken = new URLSearchParams(window.location.search).get("reset-password") ?? "";

  useEffect(() => {
    let live = true;
    const verifyToken = new URLSearchParams(window.location.search).get("verify-email");
    if (verifyToken) {
      void verifyAccountEmail(verifyToken).then(async (result) => {
        if (!live) return;
        onAccountChange(result.account);
        setMessage(result.message);
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
        if (session?.room && session.room.participants.find((seat) => seat.id === session.participantId)?.role === "player") {
          const claimed = await claimRoomSeat(session.room.code, session.token);
          onSessionChange(claimed);
        }
      }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : "Email verification failed."); });
    } else {
      void getAccount().then(({ account: current }) => { if (live) onAccountChange(current); }).catch(() => { if (live) onAccountChange(null); });
    }
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!account) { setGames([]); setStats(null); return; }
    void Promise.all([getAccountGames(), getAccountStats()]).then(([matches, currentStats]) => { setGames(matches); setStats(currentStats); }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load account data."));
  }, [account?.id]);

  useEffect(() => {
    void getLeaderboard(boardCategory).then(setBoard).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load leaderboard."));
  }, [boardCategory]);

  const run = async (action: () => Promise<void>) => {
    setError(""); setMessage(""); setActionLink("");
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Account request failed."); }
  };

  const claimCurrentSeat = async (nextAccount: AccountSummary) => {
    onAccountChange(nextAccount);
    if (session?.room && session.room.participants.find((seat) => seat.id === session.participantId)?.role === "player") {
      const claimed = await claimRoomSeat(session.room.code, session.token);
      onSessionChange(claimed);
    }
  };

  return (
    <details className="account-panel">
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
              const result = await loginAccount(email, password);
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
          {session?.room.participants.find((seat) => seat.id === session.participantId)?.role === "player" && <button type="button" className="account-link-seat" onClick={() => void run(async () => { onSessionChange(await claimRoomSeat(session.room.code, session.token)); setMessage("This match is linked to your account."); })}>Link current player seat</button>}
          <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await updateAccountUsername(username || account.username); onAccountChange(result.account); setUsername(""); setMessage("Username updated."); }); }}><label>Change username<input minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]+" value={username} placeholder={account.username} onChange={(event) => setUsername(event.target.value)} /></label><button type="submit">Save</button></form>
          {stats && <div className="account-stats"><span><strong>{stats.gamesPlayed}</strong> games</span><span><strong>{stats.wins}</strong> wins</span><span><strong>{Math.round(stats.winRate * 100)}%</strong> win rate</span><span><strong>{stats.stompedTiles}</strong> tiles stomped</span><span><strong>{stats.damageTaken}</strong> damage taken</span><span><strong>{stats.healthGained}</strong> Health restored</span><span><strong>{stats.luckAverage === null ? "—" : stats.luckAverage.toFixed(2)}</strong> luck</span></div>}
          {stats && <p className="account-choices">Most chosen: {stats.mostChosenMonster ?? "no monster"} · {stats.mostChosenBranch ?? "no branch"}</p>}
          <section className="account-matches"><h3>Your online matches</h3>{games.length ? games.map((game) => <div className="account-match" key={`${game.roomId}-${game.playerIndex}`}><span><strong>{game.code}</strong> · {game.status}{game.botAssisted ? " · bot assisted" : ""}</span>{game.status !== "completed" && <button type="button" onClick={() => void run(async () => { onSessionChange(await resumeAccountGame(game.roomId)); setMessage(`Resumed match ${game.code}.`); })}>Resume</button>}</div>) : <p>No account-linked matches yet.</p>}</section>
          <button className="account-signout" type="button" onClick={() => void run(async () => { await logoutAccount(); onAccountChange(null); setMessage("Signed out."); })}>Sign out</button>
          <button className="account-delete" type="button" onClick={() => { if (window.confirm("Delete your account? Your public profile and stats will be removed. Shared match history will remain anonymized.")) void run(async () => { await deleteAccount(); onAccountChange(null); onSessionChange(null); setMessage("Account deleted."); }); }}>Delete account</button>
        </>}
        <section className="account-leaderboard"><h3>Public rankings</h3><select aria-label="Leaderboard category" value={boardCategory} onChange={(event) => setBoardCategory(event.target.value as LeaderboardCategory)}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>{board.slice(0, 10).map((entry) => <div className="leaderboard-row" key={entry.username}><span>{entry.rank}. <button className="leaderboard-profile-button" type="button" onClick={() => void run(async () => { setLookup(entry.username); setPublicProfile(await getPlayerProfile(entry.username)); })}>@{entry.username}</button></span><strong>{boardCategory === "win-rate" ? `${(entry.value * 100).toFixed(1)}%` : boardCategory === "luck" ? entry.value.toFixed(2) : entry.value}</strong></div>)}</section>
        <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void run(async () => setPublicProfile(await getPlayerProfile(lookup))); }}><label>View public profile<input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="player username" /></label><button type="submit">View</button></form>
        {publicProfile && <div className="account-public-profile"><strong>@{publicProfile.username}</strong><span>{publicProfile.wins} wins · {publicProfile.losses} losses · {publicProfile.ties} ties · {Math.round(publicProfile.winRate * 100)}% win rate</span><span>Most chosen: {publicProfile.mostChosenMonster ?? "—"} · {publicProfile.mostChosenBranch ?? "—"}</span><span>{publicProfile.botAssistedMatches} bot-assisted results</span></div>}
      </div>
    </details>
  );
}
