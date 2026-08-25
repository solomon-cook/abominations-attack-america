interface TerminalSummaryProps {
  action: string;
  victoryType?: string;
  online: boolean;
  onLeaveRoom: () => void;
  onResetLocal: () => void;
  onRematch: () => void;
}

export function TerminalSummary({ action, victoryType, online, onLeaveRoom, onResetLocal, onRematch }: TerminalSummaryProps) {
  return (
    <div className="victory-summary">
      <strong>{action}</strong>
      <span>Victory type: {victoryType ?? "recorded terminal result"}</span>
      <div className="path-controls">
        {online ? (
          <>
            <button className="subtle" onClick={onLeaveRoom}>Return to lobby</button>
            <button className="subtle" onClick={onRematch}>Create rematch room</button>
          </>
        ) : (
          <button className="subtle" onClick={onResetLocal}>Start another local playtest</button>
        )}
      </div>
    </div>
  );
}
