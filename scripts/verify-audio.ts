import assert from "node:assert/strict";
import { setAmbientMusicPreferences } from "../apps/web/src/audio";

class FakeAudioParam {
  readonly scheduled: Array<{ kind: string; value?: number; time: number }> = [];
  setValueAtTime(value: number, time: number): void { this.scheduled.push({ kind: "set", value, time }); }
  exponentialRampToValueAtTime(value: number, time: number): void { this.scheduled.push({ kind: "ramp", value, time }); }
  setTargetAtTime(value: number, time: number): void { this.scheduled.push({ kind: "target", value, time }); }
  cancelScheduledValues(time: number): void { this.scheduled.push({ kind: "cancel", time }); }
}

class FakeGain {
  readonly gain = new FakeAudioParam();
  connect(destination: unknown): unknown { return destination; }
}

class FakeOscillator {
  type = "sine";
  readonly frequency = new FakeAudioParam();
  onended: (() => void) | null = null;
  startedAt: number | undefined;
  stoppedAt: number | undefined;
  connect(destination: unknown): unknown { return destination; }
  start(time: number): void { this.startedAt = time; }
  stop(time: number): void { this.stoppedAt = time; }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  readonly destination = {};
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  currentTime = 10;
  resumes = 0;
  constructor() { FakeAudioContext.instances.push(this); }
  createOscillator(): FakeOscillator { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
  createGain(): FakeGain { const node = new FakeGain(); this.gains.push(node); return node; }
  async resume(): Promise<void> { this.resumes += 1; }
}

let hidden = false;
let visibilityListener: (() => void) | undefined;
const fakeDocument = {
  get hidden() { return hidden; },
  addEventListener(type: string, listener: () => void) {
    assert.equal(type, "visibilitychange");
    visibilityListener = listener;
  },
};
const runtime = globalThis as typeof globalThis & { document: unknown; window: unknown };
Object.defineProperty(runtime, "document", { configurable: true, value: fakeDocument });
Object.defineProperty(runtime, "window", { configurable: true, value: {} });

const preferences = { masterVolume: 1, musicVolume: 0.45, muted: false };
setAmbientMusicPreferences({ ...preferences, musicVolume: 0 }, false);
assert.equal(FakeAudioContext.instances.length, 0, "the default zero Music level creates no audio context");
setAmbientMusicPreferences(preferences, false);
assert.equal(FakeAudioContext.instances.length, 0, "a stored nonzero level does not autoplay in a fresh tab");
setAmbientMusicPreferences(preferences, true);
assert.equal(FakeAudioContext.instances.length, 0, "browsers without Web Audio safely remain silent after opt-in");
Object.assign(runtime.window as object, { AudioContext: FakeAudioContext });
setAmbientMusicPreferences(preferences);

assert.equal(FakeAudioContext.instances.length, 1, "a Music slider gesture enables the browser audio context");
const audio = FakeAudioContext.instances[0]!;
assert.equal(audio.oscillators.length, 8, "opt-in schedules the eight-note ambient phrase");
assert.equal(audio.resumes, 1, "opt-in resumes the audio context");
assert.ok(audio.oscillators.every((oscillator) => oscillator.startedAt !== undefined && oscillator.stoppedAt !== undefined));
const initialMusicPeak = audio.gains[0]?.gain.scheduled.find((entry) => entry.kind === "ramp")?.value;
assert.equal(initialMusicPeak, 0.45 * 1 * 0.018, "music level scales the synthesized phrase");
setAmbientMusicPreferences({ ...preferences, masterVolume: 0.5 });
const reducedMasterPeak = audio.gains[8]?.gain.scheduled.find((entry) => entry.kind === "ramp")?.value;
assert.equal(reducedMasterPeak, 0.45 * 0.5 * 0.018, "master level scales music independently of effects");

setAmbientMusicPreferences({ ...preferences, muted: true });
assert.ok(audio.oscillators.every((oscillator) => oscillator.stoppedAt !== undefined), "mute stops active notes");
setAmbientMusicPreferences({ ...preferences, masterVolume: 0.5 });
assert.equal(audio.oscillators.length, 24, "unmuting resumes after the player's prior opt-in");

hidden = true;
visibilityListener?.();
assert.equal(audio.oscillators.length, 24, "a hidden page does not schedule more notes");
assert.ok(audio.oscillators.slice(16).every((oscillator) => oscillator.stoppedAt !== undefined), "hiding the page stops active notes");
hidden = false;
visibilityListener?.();
assert.equal(audio.oscillators.length, 32, "returning to a visible tab resumes the opted-in ambient phrase");

setAmbientMusicPreferences({ ...preferences, musicVolume: 0 });
assert.ok(audio.oscillators.slice(24).every((oscillator) => oscillator.stoppedAt !== undefined), "zero Music level stops playback");
console.log("Audio preference checks passed: silent default, opt-in, unsupported Web Audio, music/master scaling, mute, visibility, resume, and zero level.");
