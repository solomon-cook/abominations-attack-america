import type { GameCommand } from "@abominations/game-engine";

type Props = {
  label: string;
  contextLabel?: string;
  guidance?: string;
  onPrimary?: () => void;
  canAct: boolean;
  command?: GameCommand;
  unavailableReason?: string;
  onAction: (command: GameCommand) => void;
};

export function ActionDock({ contextLabel, guidance, onPrimary, label, canAct, command, unavailableReason, onAction }: Props) {
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
      <div className="action-dock-info"><span className="label">{contextLabel ?? "TAKE ACTION"}</span><small id="action-dock-status" className="action-dock-status" aria-live="polite">{!canAct ? status : guidance ?? status}</small></div>
      <button type="button" data-action-icon={actionIcon} aria-label={label} disabled={!canAct || (!command && !onPrimary)} title={status} aria-describedby="action-dock-status" onClick={() => onPrimary ? onPrimary() : command && onAction(command)}>
        {label}
      </button>
    </div>
  );
}
