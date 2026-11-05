import { Schema } from 'effect';
import { bridgeMethod } from '../../../views/contract/wire/bridge.js';
import { RecognizerAsk } from './listening.js';
import { SpeakAsk } from './speaking.js';

const subscription = Schema.String.check(Schema.isMinLength(1));

export const SpeechViewAsk = Schema.Union([
  Schema.Struct({ action: Schema.Literal('status') }),
  Schema.Struct({ action: Schema.Literal('recognize'), recognizer: Schema.optional(RecognizerAsk) }),
  Schema.Struct({ action: Schema.Literal('unsubscribe'), subscription }),
  Schema.Struct({ action: Schema.Literal('finish'), subscription }),
  Schema.Struct({ action: Schema.Literal('speak'), ...SpeakAsk.fields }),
  Schema.Struct({ action: Schema.Literal('silence') }),
]);
export type SpeechViewAsk = typeof SpeechViewAsk.Type;

export const SPEECH_NOTIFICATION = 'tagma/notifications/speech';

const SPEECH_REFERENCE = `A plugin view listens and speaks through Tagma's own speech with the request \`tagma/speech {action, …}\`: no keys, models or microphone of its own. Only plugin views get this method.

| \`action\` | Params | Answer |
|---|---|---|
| \`status\` | — | what \`speech_status\` answers: audio devices and permissions, every model and whether it can run now |
| \`recognize\` | \`recognizer?: {provider?, model?, turns?, languages?, speakers?, account?}\` | \`{subscription}\` |
| \`finish\` | \`subscription\` of a \`recognize\` | its final answer |
| \`unsubscribe\` | \`subscription\` | \`{}\` |
| \`speak\` | \`text\`, \`provider?\`, \`model?\`, \`voice?\`, \`language?\` | \`{status: "spoken", …}\` once playback ends |
| \`silence\` | — | \`{status: "stopped", voices}\` |

- A subscription's events arrive as \`tagma/notifications/speech {subscription, event}\`; \`event: null\` is its end, and \`{subscription, failure: {code, reason, unblock}}\` a refusal after it opened. An event, even the end of a short recognition, may arrive before the answer that opened it.
- \`recognize\` events are \`{kind: "utterance", track, segment, seq, revision, closed, text, hypothesis, from, to, speaker}\`, \`{kind: "state", state}\`, \`{kind: "track", track, phase, reason, …}\`, \`{kind: "level", track, rms, peak, at}\` and \`{kind: "gap", track, from, to, cause, message}\`. An utterance is one line keyed by \`track\`, \`segment\` and \`seq\`, ordered by \`seq\`: a higher \`revision\` replaces it, \`text\` is what is confirmed, \`hypothesis\` the guess still open, and \`closed\` makes it final.
- \`recognize\` captures where the operator's dictation does: on the server's machine the server records, on a paired device the device's own microphone. Call \`finish\` only after an event \`{kind: "state", state: "live"}\`; it reads the tail and the subscription ends by itself. \`unsubscribe\` and teardown cut it at once.
- \`speak\` plays on the device where the view is open, not on the server's speakers. \`silence\`, a new phrase and teardown stop only this view's speech.
- Losing the live connection ends every subscription and capture with a \`speech-interrupted\` failure; open them again.`;

export const SPEECH_BRIDGE = bridgeMethod({
  id: 'speech',
  notifications: [SPEECH_NOTIFICATION],
  signature: '{action, …}',
  description: 'Recognition and spoken replies through Tagma’s speech.',
  reference: { title: 'Speech in a view', text: SPEECH_REFERENCE },
});
