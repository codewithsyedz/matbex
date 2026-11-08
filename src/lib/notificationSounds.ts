// Notification sound utilities using Web Audio API

export type SoundTheme = "default" | "subtle" | "urgent" | "muted";

interface SoundConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  pattern: number[];
}

const SOUND_CONFIGS: Record<SoundTheme, SoundConfig> = {
  default: {
    frequency: 440,
    duration: 150,
    type: "sine",
    pattern: [1, 0.5, 1],
  },
  subtle: {
    frequency: 520,
    duration: 100,
    type: "sine",
    pattern: [0.5],
  },
  urgent: {
    frequency: 880,
    duration: 100,
    type: "square",
    pattern: [1, 0.3, 1, 0.3, 1],
  },
  muted: {
    frequency: 300,
    duration: 80,
    type: "sine",
    pattern: [0.3],
  },
};

// Action to sound theme mapping for different event urgencies
export const ACTION_SOUND_MAP: Record<string, SoundTheme> = {
  DELETE: "urgent",
  BULK_DELETE: "urgent",
  PERMISSION_CHANGE: "urgent",
  USER_ROLE_CHANGE: "default",
  SETTINGS_CHANGE: "subtle",
  DATA_EXPORT: "subtle",
  SHIFT_TIMESTAMP_OVERRIDE: "default",
};

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

export async function playNotificationSound(
  theme: SoundTheme = "default",
  volume: number = 50
): Promise<void> {
  if (theme === "muted" || volume === 0) return;

  try {
    const ctx = getAudioContext();
    
    // Resume audio context if suspended (browser autoplay policy)
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const config = SOUND_CONFIGS[theme];
    const normalizedVolume = Math.min(100, Math.max(0, volume)) / 100;

    let currentTime = ctx.currentTime;

    for (const patternVolume of config.pattern) {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = config.type;
      oscillator.frequency.setValueAtTime(config.frequency, currentTime);

      const noteVolume = normalizedVolume * patternVolume * 0.3; // Scale down to prevent clipping
      gainNode.gain.setValueAtTime(0, currentTime);
      gainNode.gain.linearRampToValueAtTime(noteVolume, currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, currentTime + config.duration / 1000);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start(currentTime);
      oscillator.stop(currentTime + config.duration / 1000 + 0.01);

      currentTime += config.duration / 1000 + 0.05;
    }
  } catch (error) {
    console.warn("Failed to play notification sound:", error);
  }
}

export function getSoundThemeForAction(action: string): SoundTheme {
  return ACTION_SOUND_MAP[action] || "default";
}

export function previewSound(theme: SoundTheme, volume: number): void {
  playNotificationSound(theme, volume);
}
