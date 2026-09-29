export type UiSound = "move" | "select" | "back";

interface Voice {
  /** Start and end pitch (Hz) — a small downward sweep reads as a soft "tick" rather than a beep. */
  from: number;
  to: number;
  durationMs: number;
  gain: number;
  type: OscillatorType;
}

/**
 * Fire TV-style navigation sounds, synthesized with Web Audio rather than
 * shipped as files: nothing to fetch or decode, and an oscillator starts
 * within a frame, so the tick lands with the focus change instead of after it.
 */
const VOICES: Record<UiSound, Voice> = {
  move: { from: 1900, to: 1500, durationMs: 28, gain: 0.07, type: "sine" },
  select: { from: 1100, to: 700, durationMs: 55, gain: 0.12, type: "triangle" },
  back: { from: 700, to: 420, durationMs: 60, gain: 0.1, type: "triangle" },
};

/**
 * Two listeners can see the same key press (a screen and an overlay both
 * running useRemoteInput, or a Select keyup plus the pointer click it
 * causes) — one press is one sound. Also caps held-D-pad repeats below the
 * point where ticks blur into a buzz.
 */
const MIN_GAP_MS = 35;

let enabled = true;
let context: AudioContext | null = null;
let unavailable = false;
const lastPlayedAt: Record<UiSound, number> = { move: -Infinity, select: -Infinity, back: -Infinity };

/** Applied immediately — the Settings toggle calls this alongside saving the setting. */
export function setUiSoundsEnabled(value: boolean): void {
  enabled = value;
}

function getContext(): AudioContext | null {
  if (context || unavailable) return context;
  // Older webOS WebKit builds only expose the prefixed constructor.
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    unavailable = true;
    return null;
  }
  try {
    context = new Ctor();
  } catch {
    unavailable = true;
  }
  return context;
}

export function playUiSound(sound: UiSound): void {
  if (!enabled) return;
  const now = performance.now();
  if (now - lastPlayedAt[sound] < MIN_GAP_MS) return;
  lastPlayedAt[sound] = now;

  const ctx = getContext();
  if (!ctx) return;
  // Created before any user gesture, the context starts suspended; every
  // call here comes from a key press or click, which is allowed to resume it.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  try {
    const voice = VOICES[sound];
    const start = ctx.currentTime;
    const end = start + voice.durationMs / 1000;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(voice.from, start);
    osc.frequency.exponentialRampToValueAtTime(voice.to, end);
    // 2ms attack avoids a click from starting mid-waveform; exponential decay to near-silence.
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(voice.gain, start + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(amp).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.01);
  } catch {
    // Audio is a nicety — never let it break navigation.
  }
}

/**
 * Pointer (Magic Remote) clicks on buttons get the select sound too — D-pad
 * selects are covered in useRemoteInput. Call once at startup.
 */
export function installPointerClickSounds(): void {
  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest("button, [role='button']")) playUiSound("select");
    },
    true,
  );
}
