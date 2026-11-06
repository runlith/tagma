import { capability } from '../../../views/contract/wire/capabilities.js';

const SPEECH_REFERENCE = `A plugin view listens and speaks through Tagma's own speech with \`useTagma().speech\`: no keys, models or microphone of its own.

- \`status()\` — what \`speech_status\` answers: audio devices and permissions, every model and whether it can run now.
- \`recognize({recognizer?}, {heard, ended})\` — starts listening and answers \`{finish(), stop()}\`. \`recognizer\`: \`{provider?, model?, turns?, languages?, speakers?, account?}\`. \`heard(event)\` gets each event; \`ended(failure)\` is called once, with \`null\` for a clean end or the reason.
- \`finish()\` — call it only after the event \`{kind: "state", state: "live"}\`; it reads the tail, answers the final result, and the recognition then ends by itself. \`stop()\` cuts it at once.
- \`speak({text, provider?, model?, voice?, language?})\` — answers \`{provider, model, voice}\` once playback ends.
- \`silence()\` — stops this view's speech and answers how many voices it stopped.

- Events are \`{kind: "utterance", track, segment, seq, revision, closed, text, hypothesis, from, to, speaker}\`, \`{kind: "state", state}\`, \`{kind: "track", track, phase, reason, …}\`, \`{kind: "level", track, rms, peak, at}\` and \`{kind: "gap", track, from, to, cause, message}\`. An utterance is one line keyed by \`track\`, \`segment\` and \`seq\`, ordered by \`seq\`: a higher \`revision\` replaces it, \`text\` is what is confirmed, \`hypothesis\` the guess still open, and \`closed\` makes it final.
- Recognition captures where the operator's dictation does: on the server's machine the server records, on a paired device the device's own microphone.
- \`speak\` plays on the device where the view is open, not on the server's speakers. \`silence\`, a new phrase and unmounting stop only this view's speech; unmounting also stops its recognitions.
- Losing the live connection ends every recognition with a failure; start it again.`;

export const SPEECH_CAPABILITY = capability({
  id: 'speech',
  signature: '.status() · .recognize(…) · .speak(…) · .silence()',
  description: 'Recognition and spoken replies through Tagma’s speech.',
  reference: { title: 'Speech in a view', text: SPEECH_REFERENCE },
});
