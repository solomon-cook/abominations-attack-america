import type { GameCommand } from "@abominations/game-engine";

type Props = {
  label: string;
  canAct: boolean;
  command?: GameCommand;
  unavailableReason?: string;
  onAction: (command: GameCommand) => void;
  onOpenPanel: () => void;
};

export function ActionDock({ label, canAct, command, unavailableReason, onAction, onOpenPanel }: Props) {
  const status = !canAct
    ? unavailableReason || "This action is not currently available."
    : command
      ? "Ready to submit the highlighted action."
      : label;
  return (
    <div className="action-dock" aria-label="Current action control">
      <span className="label">TAKE ACTION</span>
      <button type="button" disabled={!canAct || !command} title={status} aria-describedby="action-dock-status" onClick={() => command && onAction(command)}>
        {label}
      </button>
      <small id="action-dock-status" className="action-dock-status" aria-live="polite">{status}</small>
      <button type="button" className="action-dock-secondary" onClick={onOpenPanel}>
        Show details
      </button>
    </div>
  );
}
