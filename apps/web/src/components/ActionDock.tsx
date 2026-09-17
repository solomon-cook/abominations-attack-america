import type { GameCommand } from "@abominations/game-engine";

type Props = {
  label: string;
  onPrimary?: () => void;
  secondaryAction?: { label: string; command: GameCommand };
  canAct: boolean;
  command?: GameCommand;
  unavailableReason?: string;
  onAction: (command: GameCommand) => void;
};

export function ActionDock({ onPrimary, secondaryAction, label, canAct, command, unavailableReason, onAction }: Props) {
  const actionIcon = command?.type === "move" || command?.type === "move-unit"
    ? "↝"
    : command?.type === "resolve-fight"
      ? "⚔"
      : command?.type === "pass-deploy"
        ? "▶"
        : command?.type === "resolve-encounter"
          ? "✦"
          : command
            ? "◆"
            : "…";
  const status = !canAct
    ? unavailableReason || "This action is not currently available."
    : command
      ? "Ready."
      : label;
  return (
    <div className="action-dock" aria-label="Current action control">
      <span className="label">TAKE ACTION</span>
      <button type="button" data-action-icon={actionIcon} aria-label={label} disabled={!canAct || (!command && !onPrimary)} title={status} aria-describedby="action-dock-status" onClick={() => onPrimary ? onPrimary() : command && onAction(command)}>
        {label}
      </button>
      <small id="action-dock-status" className="action-dock-status" aria-live="polite">{status}</small>
      {secondaryAction && <button type="button" disabled={!canAct} onClick={() => onAction(secondaryAction.command)}>{secondaryAction.label}</button>}
    </div>
  );
}
