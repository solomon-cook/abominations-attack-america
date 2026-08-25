import type { GameCommand } from "@abominations/game-engine";

type Props = {
  label: string;
  canAct: boolean;
  command?: GameCommand;
  onAction: (command: GameCommand) => void;
};

export function ActionDock({ label, canAct, command, onAction }: Props) {
  return (
    <div className="action-dock" aria-label="Current action control">
      <span className="label">TAKE ACTION</span>
      <button type="button" disabled={!canAct || !command} onClick={() => command && onAction(command)}>
        {label}
      </button>
    </div>
  );
}
