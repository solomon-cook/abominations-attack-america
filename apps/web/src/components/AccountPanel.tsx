import { useEffect, useState } from "react";
import type { AccountSummary, AccountGameSummary, LeaderboardCategory, LeaderboardEntry, PlayerStats, SessionResponse, SocialSummary } from "@abominations/shared";
import {
  claimRoomSeat,
  completeAccountPasswordReset,
  acceptFriendInviteLink,
  createFriendInviteLink,
  deleteAccount,
  getAccount,
  getAccountGames,
  getAccountPrivacySettings,
  getAccountStats,
  getSocialSummary,
  getLeaderboard,
  getPlayerProfile,
  loginAccount,
  logoutAccount,
  registerAccount,
  requestAccountPasswordReset,
  resendAccountVerification,
  resumeAccountGame,
  refreshPresence,
  removeFriend,
  revokeFriendInviteLink,
  removeSavedOpponent,
  respondToFriendInvitation,
  saveOpponent,
  sendFriendInvitation,
  setPresence,
  updateAccountUsername,
  updateAccountPrivacySettings,
  verifyAccountEmail,
} from "../api";

type Props = {
  account: AccountSummary | null;
  session: SessionResponse | null;
  onAccountChange: (account: AccountSummary | null) => void;
  onSessionChange: (session: SessionResponse | null) => void;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  compact?: boolean;
  deferAccountRequests?: boolean;
};

const categories: { value: LeaderboardCategory; label: string }[] = [
  { value: "wins", label: "Wins" },
  { value: "win-rate", label: "Win rate" },
  { value: "stomped-tiles", label: "Tiles stomped" },
  { value: "damage-taken", label: "Damage taken" },
  { value: "health-gained", label: "Health restored" },
  { value: "luck", label: "Luck" },
];

export function AccountPanel({ account, session, onAccountChange, onSessionChange, onOpenChange, defaultOpen = false, compact = false, deferAccountRequests = false }: Props) {
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
  const [publicStatsEnabled, setPublicStatsEnabled] = useState<boolean | null>(null);
  const [social, setSocial] = useState<SocialSummary | null>(null);
  const [friendUsername, setFriendUsername] = useState("");
  const [savedUsername, setSavedUsername] = useState("");
  const [createdInviteLink, setCreatedInviteLink] = useState("");
  const [friendInviteToken, setFriendInviteToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("friend-invite") ?? "");
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [boardCategory, setBoardCategory] = useState<LeaderboardCategory>("wins");
  const [publicProfile, setPublicProfile] = useState<(PlayerStats & { botAssistedMatches: number }) | null>(null);
  const resetToken = new URLSearchParams(window.location.search).get("reset-password") ?? "";

  useEffect(() => {
    if (deferAccountRequests && !defaultOpen) return;
    const syncFriendInviteToken = () => setFriendInviteToken(new URLSearchParams(window.location.hash.slice(1)).get("friend-invite") ?? "");
    window.addEventListener("hashchange", syncFriendInviteToken);
    return () => window.removeEventListener("hashchange", syncFriendInviteToken);
  }, [deferAccountRequests, defaultOpen]);

  useEffect(() => {
    if (deferAccountRequests && !defaultOpen) return;
    let live = true;
    const verifyToken = new URLSearchParams(window.location.search).get("verify-email");
    if (verifyToken) {
      void verifyAccountEmail(verifyToken).then(async (result) => {
        if (!live) return;
        onAccountChange(result.account);
        setMessage(result.message);
        const remainingUrl = new URL(window.location.href);
        remainingUrl.searchParams.delete("verify-email");
        window.history.replaceState({}, "", `${remainingUrl.pathname}${remainingUrl.search}${remainingUrl.hash}`);
        if (session?.room && session.room.participants.find((seat) => seat.id === session.participantId)?.role === "player") {
          const claimed = await claimRoomSeat(session.room.code, session.token);
          onSessionChange(claimed);
        }
      }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : "Email verification failed."); });
    } else {
      void getAccount().then(({ account: current }) => { if (live) onAccountChange(current); }).catch(() => { if (live) onAccountChange(null); });
    }
    return () => { live = false; };
  }, [deferAccountRequests, defaultOpen]);

  useEffect(() => {
    if (deferAccountRequests && !defaultOpen) return;
    if (!account) { setGames([]); setStats(null); setSocial(null); setPublicStatsEnabled(null); return; }
    void Promise.all([getAccountGames(), getAccountStats(), getSocialSummary(), getAccountPrivacySettings()]).then(([matches, currentStats, currentSocial, privacy]) => { setGames(matches); setStats(currentStats); setSocial(currentSocial); setPublicStatsEnabled(privacy.publicStatsEnabled); }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load account data."));
  }, [account?.id, deferAccountRequests, defaultOpen]);

  useEffect(() => {
    if (deferAccountRequests && !defaultOpen) return;
    if (!account || !social?.presenceEnabled) return;
    const heartbeat = () => { if (document.visibilityState === "visible") void refreshPresence().catch(() => undefined); };
    heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", heartbeat); };
  }, [account?.id, social?.presenceEnabled, deferAccountRequests, defaultOpen]);

  useEffect(() => {
    if (deferAccountRequests && !defaultOpen) return;
    void getLeaderboard(boardCategory).then(setBoard).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load leaderboard."));
  }, [boardCategory, deferAccountRequests, defaultOpen]);

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

  const reloadSocial = async () => setSocial(await getSocialSummary());
  const socialAction = (action: () => Promise<unknown>) => void run(async () => { await action(); await reloadSocial(); });
  const clearFriendInviteToken = () => {
    const acceptedUrl = new URL(window.location.href);
    const fragment = new URLSearchParams(acceptedUrl.hash.slice(1));
    fragment.delete("friend-invite");
    acceptedUrl.hash = fragment.toString();
    window.history.replaceState({}, "", `${acceptedUrl.pathname}${acceptedUrl.search}${acceptedUrl.hash}`);
    setFriendInviteToken("");
  };

  return (
    <details className={`account-panel${compact ? " account-panel-compact" : ""}`} open={defaultOpen || undefined} onToggle={(event) => onOpenChange?.((event.currentTarget as HTMLDetailsElement).open)}>
      <summary><span>PLAYER ACCOUNT</span><strong>{account ? `@${account.username}` : "Sign in · save matches and stats"}</strong></summary>
      <div className="account-panel-content">
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="account-message" role="status">{message}</p>}
        {!account ? <>
          {friendInviteToken && <p className="account-private-note">Sign in or create an account to accept this private friend invitation.</p>}
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
          {!compact && <div className="account-secondary-actions">
            <button type="button" onClick={() => void run(async () => { const result = await resendAccountVerification(email); setMessage(result.message); if (result.developmentLink) setActionLink(result.developmentLink); })}>Resend verification</button>
            <button type="button" onClick={() => void run(async () => { const result = await requestAccountPasswordReset(email); setMessage(result.message); if (result.developmentLink) setActionLink(result.developmentLink); })}>Reset password</button>
          </div>}
          {actionLink && <a className="account-action-link" href={actionLink}>Continue with account link</a>}
          {resetToken && <form className="account-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await completeAccountPasswordReset(resetToken, newPassword); setMessage(result.message); }); }}><label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><button type="submit">Set new password</button></form>}
        </> : <>
          <div className="account-identity"><span>Public username</span><strong>@{account.username}</strong><span>{account.emailVerified ? "Email verified" : "Email verification required"}</span></div>
          {friendInviteToken && <div className="account-private-note" role="group" aria-label="Private friend invitation"><p>A private friend invitation is ready. Accept it to add the sender to your friends.</p><button type="button" onClick={() => void run(async () => { const result = await acceptFriendInviteLink(friendInviteToken); setMessage(result.message); await reloadSocial(); clearFriendInviteToken(); })}>Accept friend invitation</button></div>}
          {session?.room.participants.find((seat) => seat.id === session.participantId)?.role === "player" && <button type="button" className="account-link-seat" onClick={() => void run(async () => { onSessionChange(await claimRoomSeat(session.room.code, session.token)); setMessage("This match is linked to your account."); })}>Link current player seat</button>}
          <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await updateAccountUsername(username || account.username); onAccountChange(result.account); setUsername(""); setMessage("Username updated."); }); }}><label>Change username<input minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]+" value={username} placeholder={account.username} onChange={(event) => setUsername(event.target.value)} /></label><button type="submit">Save</button></form>
          {social && <section className="account-social" aria-label="Friends and saved opponents">
            <h3>Friends and saved opponents</h3>
            <label className="account-presence"><input type="checkbox" checked={social.presenceEnabled} onChange={(event) => socialAction(async () => { await setPresence(event.target.checked); })} /> Show online status to friends while this tab is active</label>
            <div className="account-invite-link-tools"><button type="button" onClick={() => socialAction(async () => { const link = await createFriendInviteLink(); setCreatedInviteLink(link.url); })}>Create private friend link</button>{createdInviteLink && <><label>Private friend link<input aria-label="Private friend link" readOnly value={createdInviteLink} /></label><button type="button" onClick={() => void run(async () => { await navigator.clipboard.writeText(createdInviteLink); setMessage("Friend link copied."); })}>Copy link</button></>}</div>
            {social.inviteLinks.length > 0 && <div className="account-social-group"><h4>Active private links</h4>{social.inviteLinks.map((invite) => <div className="account-social-row" key={invite.id}><span>Expires {new Date(invite.expiresAt).toLocaleDateString()}</span><button type="button" onClick={() => socialAction(() => revokeFriendInviteLink(invite.id))}>Revoke</button></div>)}</div>}
            <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); const target = friendUsername.trim(); if (!target) return; socialAction(async () => { await sendFriendInvitation(target); setFriendUsername(""); }); }}><label>Invite by username<input value={friendUsername} onChange={(event) => setFriendUsername(event.target.value)} placeholder="player username" /></label><button type="submit">Invite</button></form>
            <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); const target = savedUsername.trim(); if (!target) return; socialAction(async () => { await saveOpponent(target); setSavedUsername(""); }); }}><label>Save an opponent<input value={savedUsername} onChange={(event) => setSavedUsername(event.target.value)} placeholder="player username" /></label><button type="submit">Save</button></form>
            <div className="account-social-group"><h4>Friends</h4>{social.friends.length ? social.friends.map((friend) => <div className="account-social-row" key={friend.username}><span>@{friend.username} · {friend.online ? "online" : "offline"}</span><button type="button" onClick={() => socialAction(() => removeFriend(friend.username))}>Remove</button></div>) : <p>No friends yet.</p>}</div>
            <div className="account-social-group"><h4>Incoming invitations</h4>{social.incoming.length ? social.incoming.map((invite) => <div className="account-social-row" key={invite.id}><span>@{invite.username}</span><span className="account-social-buttons"><button type="button" onClick={() => socialAction(() => respondToFriendInvitation(invite.id, "accept"))}>Accept</button><button type="button" onClick={() => socialAction(() => respondToFriendInvitation(invite.id, "decline"))}>Decline</button></span></div>) : <p>No pending invitations.</p>}</div>
            <div className="account-social-group"><h4>Sent invitations</h4>{social.outgoing.length ? social.outgoing.map((invite) => <div className="account-social-row" key={invite.id}><span>@{invite.username}</span><button type="button" onClick={() => socialAction(() => respondToFriendInvitation(invite.id, "revoke"))}>Revoke</button></div>) : <p>No sent invitations.</p>}</div>
            <div className="account-social-group"><h4>Saved opponents</h4>{social.savedOpponents.length ? social.savedOpponents.map((opponent) => <div className="account-social-row" key={opponent}><span>@{opponent}</span><button type="button" onClick={() => socialAction(() => removeSavedOpponent(opponent))}>Remove</button></div>) : <p>No saved opponents.</p>}</div>
          </section>}
          {stats && <div className="account-stats"><span><strong>{stats.gamesPlayed}</strong> games</span><span><strong>{stats.wins}</strong> wins</span><span><strong>{Math.round(stats.winRate * 100)}%</strong> win rate</span><span><strong>{stats.stompedTiles}</strong> tiles stomped</span><span><strong>{stats.damageTaken}</strong> damage taken</span><span><strong>{stats.healthGained}</strong> Health restored</span><span><strong>{stats.luckAverage === null ? "—" : stats.luckAverage.toFixed(2)}</strong> luck</span></div>}
          {stats && <p className="account-choices">Most chosen: {stats.mostChosenMonster ?? "no monster"} · {stats.mostChosenBranch ?? "no branch"}</p>}
          {publicStatsEnabled !== null && <label className="account-privacy-control"><input type="checkbox" checked={publicStatsEnabled} onChange={(event) => { const enabled = event.currentTarget.checked; void run(async () => { const updated = await updateAccountPrivacySettings(enabled); setPublicStatsEnabled(updated.publicStatsEnabled); if (!updated.publicStatsEnabled && publicProfile?.username === account.username) setPublicProfile(null); setBoard(await getLeaderboard(boardCategory)); setMessage(updated.publicStatsEnabled ? "Your public profile and rankings are visible." : "Your public profile and rankings are hidden."); }); }} /><span><strong>Show my username and stats in public profiles and rankings</strong><small>Your match history and stats remain available to you while signed in.</small></span></label>}
          <section className="account-matches"><h3>Your online matches</h3>{games.length ? games.map((game) => <div className="account-match" key={`${game.roomId}-${game.playerIndex}`}><span><strong>{game.code}</strong> · {game.status}{game.botAssisted ? " · bot assisted" : ""}</span>{game.status !== "completed" && <button type="button" onClick={() => void run(async () => { onSessionChange(await resumeAccountGame(game.roomId)); setMessage(`Resumed match ${game.code}.`); })}>Resume</button>}</div>) : <p>No account-linked matches yet.</p>}</section>
          <button className="account-signout" type="button" onClick={() => void run(async () => { await logoutAccount(); onAccountChange(null); setMessage("Signed out."); })}>Sign out</button>
          <button className="account-delete" type="button" onClick={() => { if (window.confirm("Delete your account? Your public profile and stats will be removed. Shared match history will remain anonymized.")) void run(async () => { await deleteAccount(); onAccountChange(null); onSessionChange(null); setMessage("Account deleted."); }); }}>Delete account</button>
        </>}
        {!compact && <section className="account-leaderboard"><h3>Public rankings</h3><select aria-label="Leaderboard category" value={boardCategory} onChange={(event) => setBoardCategory(event.target.value as LeaderboardCategory)}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>{board.slice(0, 10).map((entry) => <div className="leaderboard-row" key={entry.username}><span>{entry.rank}. <button className="leaderboard-profile-button" type="button" onClick={() => void run(async () => { setLookup(entry.username); setPublicProfile(await getPlayerProfile(entry.username)); })}>@{entry.username}</button></span><strong>{boardCategory === "win-rate" ? `${(entry.value * 100).toFixed(1)}%` : boardCategory === "luck" ? entry.value.toFixed(2) : entry.value}</strong></div>)}</section>}
        <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void run(async () => setPublicProfile(await getPlayerProfile(lookup))); }}><label>View public profile<input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="player username" /></label><button type="submit">View</button></form>
        {publicProfile && <div className="account-public-profile"><strong>@{publicProfile.username}</strong><span>{publicProfile.wins} wins · {publicProfile.losses} losses · {publicProfile.ties} ties · {Math.round(publicProfile.winRate * 100)}% win rate</span><span>Most chosen: {publicProfile.mostChosenMonster ?? "—"} · {publicProfile.mostChosenBranch ?? "—"}</span><span>{publicProfile.botAssistedMatches} bot-assisted results</span></div>}
      </div>
    </details>
  );
}
