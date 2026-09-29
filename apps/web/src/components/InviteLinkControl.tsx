import { useId, useState } from "react";

type InviteLinkControlProps = {
  roomCode: string;
  buttonClassName?: string;
};

export function InviteLinkControl({ roomCode, buttonClassName = "subtle" }: InviteLinkControlProps) {
  const statusId = useId();
  const [status, setStatus] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");

  if (!roomCode) return null;

  const copyInviteLink = async () => {
    const inviteUrl = new URL(window.location.href);
    inviteUrl.search = `?room=${encodeURIComponent(roomCode)}`;
    try {
      await navigator.clipboard.writeText(inviteUrl.toString());
      setFallbackUrl("");
      setStatus("Invite link copied");
    } catch {
      setFallbackUrl(inviteUrl.toString());
      setStatus("Clipboard access failed. Select the invite link below and copy it.");
    }
  };

  return (
    <div className="invite-link-control">
      <button type="button" className={buttonClassName} onClick={() => void copyInviteLink()}>Copy invite link</button>
      {status && (
        <>
          <span id={statusId} className="invite-status" role="status">{status}</span>
          {fallbackUrl && (
            <label className="invite-fallback">
              Invite link
              <input
                aria-describedby={statusId}
                aria-label="Invite link to select and copy"
                readOnly
                value={fallbackUrl}
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.currentTarget.select()}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}
