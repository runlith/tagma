import type { SpeechStatus } from '@tagma/server/speech/contract/wire/status';
import { readiness } from '../check.js';
import { told, type Message } from '../words.js';
import { microphoneMissing } from './Sender.js';

export function blocked(status: SpeechStatus): Message | null {
  if (status.mic === 'server') {
    const fault = readiness('mic', status.devices);
    if (fault !== null) return told(fault, 'mic');
  } else {
    const missing = microphoneMissing();
    if (missing !== null) return { title: 'This browser cannot record', detail: [missing.reason, ...missing.unblock].join(' ') };
  }
  const dictation = status.dictation;
  return dictation.kind === 'blocked'
    ? { title: 'Dictation cannot recognize now', detail: dictation.said, details: [dictation.reason, ...dictation.unblock] }
    : null;
}
