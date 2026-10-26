import type { SettingsPage } from '@tagma/server/platform/contract/wire/refusal';
import type { Told } from '$lib/wire/told.js';
import type { Fault } from './check.js';

export const unavailable = (absent: { readonly reason: string; readonly unblock: readonly string[] }): Told => ({
  text: 'This model cannot be used yet.',
  details: [absent.reason, ...absent.unblock],
});

export type Message = {
  readonly title: string;
  readonly detail: string;
  readonly settings?: SettingsPage;
  readonly details?: readonly string[];
};

export function told(fault: Fault, source: 'mic' | 'system'): Message {
  const what = source === 'mic' ? 'The microphone' : 'System audio';
  switch (fault.kind) {
    case 'no-capability':
      return { title: `${what} cannot be recorded now`, detail: fault.said, details: fault.details };
    case 'permission':
      return {
        title: fault.state === 'denied' ? `Tagma is not allowed to record ${what.toLowerCase()}` : `${what} permission is unknown`,
        detail: 'Allow Tagma in System Settings, then try again.',
        settings: source === 'mic' ? 'microphone' : 'system-audio',
      };
    case 'no-frames':
      return {
        title: 'No audio frames arrive',
        detail: 'The capture is open but sends no sound. The device may be disconnected or held by another app.',
      };
    case 'silence':
      return {
        title: 'Only silence arrives',
        detail: `${what} is captured but nothing is audible. Check the input level, the muted state and the chosen device.`,
      };
    case 'recognizer-not-ready':
      return {
        title: 'The recognizer is not ready',
        detail: fault.retryInMs === null ? 'It is still connecting.' : `Connecting again in ${(fault.retryInMs / 1000).toFixed(1)} s.`,
      };
    case 'queue-growing':
      return {
        title: 'The recognition queue is growing',
        detail: `${(fault.queuedMs / 1000).toFixed(1)} s of sound wait for the recognizer.`,
      };
    case 'provider-error':
      return { title: 'The recognizer stopped with an error', detail: 'Start the check again.', details: [fault.reason] };
  }
}
