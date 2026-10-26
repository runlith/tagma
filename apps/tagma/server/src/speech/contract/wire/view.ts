import { Schema } from 'effect';
import { RecognizerAsk } from './listening.js';
import { SpeakAsk } from './speaking.js';

const subscription = Schema.String.check(Schema.isMinLength(1));
const listening = Schema.String.check(Schema.isMinLength(1));

export const SpeechViewAsk = Schema.Union([
  Schema.Struct({ action: Schema.Literal('status') }),
  Schema.Struct({ action: Schema.Literal('recognize'), recognizer: Schema.optional(RecognizerAsk) }),
  Schema.Struct({ action: Schema.Literal('listening'), listening }),
  Schema.Struct({ action: Schema.Literal('transcript'), listening, after: Schema.optional(Schema.Int) }),
  Schema.Struct({ action: Schema.Literal('unsubscribe'), subscription }),
  Schema.Struct({ action: Schema.Literal('finish'), subscription }),
  Schema.Struct({ action: Schema.Literal('speak'), ...SpeakAsk.fields }),
  Schema.Struct({ action: Schema.Literal('silence') }),
]);
export type SpeechViewAsk = typeof SpeechViewAsk.Type;

export const SPEECH_NOTIFICATION = 'tagma/notifications/speech';
