import type { Dispatch, SetStateAction } from "react";

interface SettingsPanelProps {
  largeText: boolean;
  showBoardLabels: boolean;
  manualReducedMotion: boolean;
  confirmIrreversible: boolean;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  muted: boolean;
  setLargeText: Dispatch<SetStateAction<boolean>>;
  setShowBoardLabels: Dispatch<SetStateAction<boolean>>;
  setManualReducedMotion: Dispatch<SetStateAction<boolean>>;
  setConfirmIrreversible: Dispatch<SetStateAction<boolean>>;
  setMasterVolume: (value: number) => void;
  setMusicVolume: (value: number) => void;
  setEffectsVolume: (value: number) => void;
  setMuted: Dispatch<SetStateAction<boolean>>;
  togglePreference: (key: string, setter: Dispatch<SetStateAction<boolean>>) => void;
}

export function SettingsPanel({ largeText, showBoardLabels, manualReducedMotion, confirmIrreversible, masterVolume, musicVolume, effectsVolume, muted, setLargeText, setShowBoardLabels, setManualReducedMotion, setConfirmIrreversible, setMasterVolume, setMusicVolume, setEffectsVolume, setMuted, togglePreference }: SettingsPanelProps) {
  return (
    <section className="settings-panel" aria-label="Play preferences">
      <span className="label">PLAY PREFERENCES</span>
      <h2>Readable, controllable play</h2>
      <div className="settings-grid">
        <label><input type="checkbox" checked={largeText} onChange={() => togglePreference("abominations-large-text", setLargeText)} /> Larger text</label>
        <label><input type="checkbox" checked={showBoardLabels} onChange={() => togglePreference("abominations-board-labels", setShowBoardLabels)} /> Show board labels</label>
        <label><input type="checkbox" checked={manualReducedMotion} onChange={() => togglePreference("abominations-reduced-motion", setManualReducedMotion)} /> Reduce motion</label>
        <label><input type="checkbox" checked={confirmIrreversible} onChange={() => togglePreference("abominations-confirm-irreversible", setConfirmIrreversible)} /> Confirm disappearance</label>
        <label><input type="checkbox" checked={muted} onChange={() => togglePreference("abominations-audio-muted", setMuted)} /> Mute all feedback</label>
      </div>
      <div className="settings-audio" aria-label="Audio levels">
        <label>Master <input type="range" min="0" max="1" step="0.05" value={masterVolume} onChange={(event) => setMasterVolume(Number(event.target.value))} /></label>
        <label>Effects <input type="range" min="0" max="1" step="0.05" value={effectsVolume} onChange={(event) => setEffectsVolume(Number(event.target.value))} /></label>
        <label>Music <input type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} /></label>
      </div>
      <p className="settings-note">Short synthesized tones cover turns, dice, combat, cards, warnings, and victory. Every result and required action remains available as text.</p>
    </section>
  );
}
