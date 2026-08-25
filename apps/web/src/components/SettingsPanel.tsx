import type { Dispatch, SetStateAction } from "react";

interface SettingsPanelProps {
  largeText: boolean;
  showBoardLabels: boolean;
  manualReducedMotion: boolean;
  confirmIrreversible: boolean;
  setLargeText: Dispatch<SetStateAction<boolean>>;
  setShowBoardLabels: Dispatch<SetStateAction<boolean>>;
  setManualReducedMotion: Dispatch<SetStateAction<boolean>>;
  setConfirmIrreversible: Dispatch<SetStateAction<boolean>>;
  togglePreference: (key: string, setter: Dispatch<SetStateAction<boolean>>) => void;
}

export function SettingsPanel({ largeText, showBoardLabels, manualReducedMotion, confirmIrreversible, setLargeText, setShowBoardLabels, setManualReducedMotion, setConfirmIrreversible, togglePreference }: SettingsPanelProps) {
  return (
    <section className="settings-panel" aria-label="Play preferences">
      <span className="label">PLAY PREFERENCES</span>
      <h2>Readable, controllable play</h2>
      <div className="settings-grid">
        <label><input type="checkbox" checked={largeText} onChange={() => togglePreference("abominations-large-text", setLargeText)} /> Larger text</label>
        <label><input type="checkbox" checked={showBoardLabels} onChange={() => togglePreference("abominations-board-labels", setShowBoardLabels)} /> Show board labels</label>
        <label><input type="checkbox" checked={manualReducedMotion} onChange={() => togglePreference("abominations-reduced-motion", setManualReducedMotion)} /> Reduce motion</label>
        <label><input type="checkbox" checked={confirmIrreversible} onChange={() => togglePreference("abominations-confirm-irreversible", setConfirmIrreversible)} /> Confirm disappearance</label>
      </div>
      <p className="settings-note">The game currently has no audio dependency; every result and required action is available as text.</p>
    </section>
  );
}
