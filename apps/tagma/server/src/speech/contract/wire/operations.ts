import { type Raised } from '@runlith/agent/permissions';
import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { SpeechStatus } from './status.js';
import { SpeakAsk, Voiced } from './speaking.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { INSTALL_RUNNING } from '../../../platform/contract/wire/conditions.js';

const machine = {
  doors: { http: 'perform' },
  tool: { capability: 'speech' },
  callers: 'any',
  subject: 'none',
  place: 'machine',
  waits: [],
  lifetimes: [],
} as const;
const nobody = () => [];

const operatorOnly = {
  doors: { http: 'perform' },
  callers: 'operator',
  subject: 'none',
  place: 'machine',
  waits: [],
  lifetimes: [],
} as const;

export const RECOGNITION_OPERATIONS = {
  finish_recognition: operation('finish_recognition', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning:
      'Begin finishing an open recognition without a listening: its tracks stop capturing and each recognizer is asked to confirm its tail. The call answers once capture has ended; confirmation is not awaited.',
    grammar:
      'The id is the one the speech.recognize feed was asked with. The last utterances arrive on that feed, which then ends; a recognizer that never confirms leaves the feed to be cut by the server after a bound, so a caller waits on the feed under its own deadline. Unsubscribing from the feed stops the recognition at once and drops the unconfirmed tail.',
    input: Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)) }),
    answer: arms({ ending: { id: Schema.String } }),
    refusals: ['unknown-recognition'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: () => ({ summary: 'Finish the recognition?' }),
    confirmLabel: 'Finish recognition',
    presentation: { running: 'Finishing the recognition', done: 'Finished the recognition' },
  }),
  stop_capture: operation('stop_capture', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning:
      'Stop one capture of this machine, or all of them: each stops the way its owner registered — a recognition stops hearing and reads out its confirmed tail, any other capture ends at once.',
    grammar:
      "Name `kind` and `id` together, as the speech.captures.subscribe feed lists them, to stop one; name neither to stop every capture. The call answers once each owner's stop has run; a recognition's confirmed tail arrives afterwards on its speech.recognize feed, which then ends.",
    input: Schema.Struct({
      kind: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      id: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    }),
    answer: arms({ stopped: { stopped: Schema.Int } }),
    refusals: ['unknown-capture', 'stop-refused', 'selection-shape'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: (input) => ({ summary: input.id === undefined ? 'Stop every capture?' : `Stop the ${input.kind} ${input.id}?` }),
    confirmLabel: 'Stop',
    presentation: { running: 'Stopping the capture', done: 'Stopped the capture' },
  }),
};

const voiced = Voiced.fields;

export const SPEAKING_OPERATIONS = {
  speak_text: operation('speak_text', {
    approval: ASKS_IN_REVIEW,
    ...machine,
    meaning: 'Say a text aloud on this machine with the voice of Settings → Speech, or the one named.',
    grammar: 'The call answers once the voice is chosen and synthesis began; the sound plays on after it.',
    input: SpeakAsk,
    answer: arms({ speaking: voiced }),
    refusals: ['no-model', 'player-refused', 'speech-failed'],
    effect: 'external',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: (input) => ({ summary: `Say "${input.text.slice(0, 80)}" aloud?` }),
    confirmLabel: 'Speak',
    presentation: { running: 'Speaking', done: 'Began speaking' },
  }),
  stop_speaking: operation('stop_speaking', {
    approval: ASKS_IN_REVIEW,
    ...machine,
    meaning: 'Silence everything this machine is saying: the players are cleared and their synthesis ends.',
    input: Schema.Struct({}),
    answer: arms({ stopped: { voices: Schema.Int } }),
    refusals: [],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: () => ({ summary: 'Stop speaking?' }),
    confirmLabel: 'Stop speaking',
    presentation: { running: 'Stopping speech', done: 'Stopped speaking' },
  }),
  speech_status: operation('speech_status', {
    approval: ASKS_NEVER,
    ...machine,
    meaning:
      'Read what speech can do on the machine running this server: its audio devices and permissions, the speech detector, every recognition and synthesis model with whether it can run now and why not, and the local models.',
    input: Schema.Struct({}),
    answer: arms({ read: { speech: SpeechStatus } }),
    refusals: ['models-unreadable'],
    effect: 'read',
    identity: 'none',
    subjects: nobody,
    confirmation: () => ({ summary: 'Read the speech status?' }),
    confirmLabel: 'Read speech status',
    presentation: { running: 'Reading the speech status', done: 'Read the speech status' },
  }),
  install_speech_model: operation('install_speech_model', {
    approval: ASKS_IN_REVIEW,
    ...machine,
    meaning: 'Download and install a local recognition model; its progress shows in speech_status.',
    input: Schema.Struct({ model: Schema.String }),
    answer: arms({ installing: { model: Schema.String }, installed: { model: Schema.String } }),
    refusals: ['unknown-model', 'models-unreadable'],
    effect: 'external',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: (input) => ({ summary: `Install the local model ${input.model}?` }),
    confirmLabel: 'Install model',
    presentation: { running: 'Installing the model', done: 'Began installing the model' },
  }),
  remove_speech_model: operation('remove_speech_model', {
    approval: { ...ASKS_IN_REVIEW, when: [INSTALL_RUNNING] },
    ...machine,
    meaning: 'Remove an installed local recognition model and what a download left of it, cancelling its install when one runs.',
    input: Schema.Struct({ model: Schema.String }),
    answer: arms({ removed: { model: Schema.String } }),
    refusals: ['unknown-model', 'models-unreadable'],
    effect: 'write',
    identity: { key: 'request' },
    intent: 'destructive',
    destructiveConsequence: (input) => `The local model ${input.model} is deleted from this machine.`,
    subjects: () => [],
    raises: (_input, consents?: readonly Raised[]) => consents ?? [],
    confirmation: (input) => ({ summary: `Remove the local model ${input.model}?` }),
    confirmLabel: 'Remove model',
    presentation: { running: 'Removing the model', done: 'Removed the model' },
  }),
};

export const SPEECH_OPERATIONS = { ...RECOGNITION_OPERATIONS, ...SPEAKING_OPERATIONS };

export type SpeechOperationId = keyof typeof SPEECH_OPERATIONS;
