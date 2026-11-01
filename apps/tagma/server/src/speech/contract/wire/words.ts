import type { Source } from '@runlith/audio/port/devices';
import type { RefusalCode } from '@runlith/audio/port/refusal';
import type { Words } from '../../../platform/contract/wire/refusal.js';

const HEARD: Readonly<Record<Source, { readonly what: string; readonly device: string; readonly settings: Words['settings'] }>> = {
  mic: { what: 'use the microphone', device: 'The microphone', settings: 'microphone' },
  system: { what: 'record system audio', device: 'The audio device', settings: 'system-audio' },
};

export const captureWords = (source: Source, code: RefusalCode): Words => {
  const heard = HEARD[source];
  switch (code) {
    case 'permission-denied':
      return { text: `Tagma is not allowed to ${heard.what}. Allow Tagma in System Settings, then try again.`, settings: heard.settings };
    case 'device-missing':
      return { text: `${heard.device} chosen for Tagma is not connected. Connect it or choose another in Settings → Speech.` };
    case 'unsupported':
      return { text: `This Mac cannot ${heard.what} for Tagma.` };
    case 'device-failed':
      return { text: `${heard.device} stopped working. Try again or choose another in Settings → Speech.` };
    case 'helper-mismatch':
    case 'unavailable':
      return { text: 'Tagma could not start recording. Try again in a moment.' };
  }
};

export const NO_MODEL_WORDS: Words = { text: 'No speech recognizer is ready. Choose one in Settings → Speech.' };

export const VOICE_WORDS = {
  failed: { text: 'Tagma could not speak this. Try again, or choose another voice in Settings → Speech.' },
  noPlayer: { text: 'Tagma could not play the sound. Check the sound output of this Mac.' },
  stopped: { text: 'Speaking was stopped.' },
  dictationLost: { text: 'The sound of this dictation did not reach Tagma. Start the dictation again.' },
} as const satisfies Readonly<Record<string, Words>>;

export const NO_SOUND_WORDS: Words = { text: 'Tagma cannot reach the sound of this Mac right now. Try again in a moment.' };
