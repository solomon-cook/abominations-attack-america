export type SoundCategory = "turn" | "dice" | "combat" | "cards" | "warnings" | "victory";

export type AudioPreferences = Readonly<{
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  muted: boolean;
}>;

let context: AudioContext | undefined;

function getContext(): AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return undefined;
  context ??= new AudioContextConstructor();
  return context;
}

const categoryNotes: Record<SoundCategory, readonly number[]> = {
  turn: [330],
  dice: [440, 554],
  combat: [110, 165],
  cards: [523, 659],
  warnings: [180, 140],
  victory: [392, 523, 659, 784],
};

/**
 * Short, synthesized feedback tones. No external audio is loaded, and a
 * failed or unavailable AudioContext never affects authoritative gameplay.
 */
export function playSound(category: SoundCategory, preferences: AudioPreferences): void {
  if (preferences.muted || preferences.masterVolume <= 0 || preferences.effectsVolume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  void audio.resume().catch(() => undefined);
  const now = audio.currentTime;
  const notes = categoryNotes[category];
  notes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = now + index * 0.07;
    const end = start + (category === "victory" ? 0.18 : 0.11);
    oscillator.type = category === "combat" ? "sawtooth" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, preferences.masterVolume * preferences.effectsVolume * 0.08), start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  });
}
