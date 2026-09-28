import type { GameCommand } from "@abominations/game-engine";
import type { MouseEvent } from "react";

type Props = {
  label: string;
  contextLabel?: string;
  guidance?: string;
  onPrimary?: (event: MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  canAct: boolean;
  command?: GameCommand;
  unavailableReason?: string;
  onAction: (command: GameCommand, opener?: HTMLButtonElement) => void;
};

export function ActionDock({ contextLabel, guidance, onPrimary, label, canAct, command, unavailableReason, onAction, pressed }: Props) {
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
      <button type="button" data-action-icon={actionIcon} aria-label={label} aria-pressed={pressed} disabled={!canAct || (!command && !onPrimary)} title={status} aria-describedby="action-dock-status" onClick={(event) => onPrimary ? onPrimary(event) : command && onAction(command, event.currentTarget)}>
        {label}
      </button>
    </div>
  );
}
