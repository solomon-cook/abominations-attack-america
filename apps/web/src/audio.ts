export type SoundCategory = "turn" | "dice" | "combat" | "cards" | "warnings" | "victory";

export type AudioPreferences = Readonly<{
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  muted: boolean;
}>;

let context: AudioContext | undefined;
let musicLevel = 0;
let musicMasterLevel = 0;
let musicMuted = true;
let musicOptedIn = false;
let musicTimer: ReturnType<typeof setInterval> | undefined;
let musicNodes = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
let musicVisibilityListenerInstalled = false;

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

const ambientNotes = [220, 261.63, 329.63, 392, 329.63, 261.63, 293.66, 349.23] as const;

function stopAmbientNotes(): void {
  if (musicTimer !== undefined) clearInterval(musicTimer);
  musicTimer = undefined;
  const audio = context;
  if (!audio) return;
  const now = audio.currentTime;
  for (const { oscillator, gain } of musicNodes) {
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.025);
      oscillator.stop(now + 0.12);
    } catch {
      // The note may already have ended while its cleanup was queued.
    }
  }
  musicNodes.clear();
}

function playAmbientPhrase(): void {
  const audio = context;
  if (!audio || !musicOptedIn || musicMuted || musicLevel <= 0 || musicMasterLevel <= 0 || document.hidden) return;
  const now = audio.currentTime + 0.03;
  ambientNotes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = now + index * 0.72;
    const end = start + 0.95;
    const node = { oscillator, gain };
    musicNodes.add(node);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, musicLevel * musicMasterLevel * 0.018), start + 0.12);
    gain.gain.setTargetAtTime(0.0001, start + 0.58, 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.onended = () => musicNodes.delete(node);
    oscillator.start(start);
    oscillator.stop(end);
  });
}

function startAmbientPlayback(): void {
  if (!musicOptedIn || musicMuted || musicLevel <= 0 || musicMasterLevel <= 0 || document.hidden) return;
  const audio = getContext();
  if (!audio) return;
  void audio.resume().catch(() => undefined);
  stopAmbientNotes();
  playAmbientPhrase();
  musicTimer = setInterval(playAmbientPhrase, 8 * 0.72 * 1000);
}

/**
 * Optional, browser-synthesized ambience. It has no sound until the player
 * moves the Music control in this tab; no external media is downloaded.
 */
export function setAmbientMusicPreferences(preferences: Pick<AudioPreferences, "masterVolume" | "musicVolume" | "muted">, fromUserGesture = false): void {
  musicLevel = Math.max(0, Math.min(1, preferences.musicVolume));
  musicMasterLevel = Math.max(0, Math.min(1, preferences.masterVolume));
  musicMuted = preferences.muted;
  if (fromUserGesture && musicLevel > 0) musicOptedIn = true;

  if (typeof document === "undefined") return;
  if (!musicVisibilityListenerInstalled) {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopAmbientNotes();
      else startAmbientPlayback();
    });
    musicVisibilityListenerInstalled = true;
  }

  if (musicLevel <= 0 || musicMuted || musicMasterLevel <= 0 || document.hidden) {
    stopAmbientNotes();
    return;
  }
  if (!musicOptedIn) return;
  startAmbientPlayback();
}

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
