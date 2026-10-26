import type { SpeechProvider } from '@runlith/speech/protocol/adapter';
import { duplex } from '@runlith/speech/protocol/duplex';
import { synthesisDuplex } from '@runlith/speech/protocol/synthesisDuplex';
import type { DuplexTransport } from '@runlith/speech/protocol/transport';
import { SpeechFailure } from '@runlith/speech/wire/failure';
import { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import { Credential } from './credential.ts';
import { recognitionModels, synthesisModels } from './models.ts';
import { recognition } from './recognition.ts';
import { synthesis } from './synthesis.ts';
import { API, discarded, resumed, transcribed } from './transcription.ts';

export const soniox: SpeechProvider<Credential, DuplexTransport | HttpClient.HttpClient> = {
  id: 'soniox',
  label: 'Soniox',
  credential: { _tag: 'required', schema: Credential },
  egress: ['wss://stt-rt.soniox.com', 'wss://tts-rt.soniox.com', API],
  availability: () => Effect.succeed({ _tag: 'present' }),
  recognizer: {
    models: recognitionModels,
    stream: (model, request, credential) => duplex(recognition(model, request, credential)),
    file: transcribed,
    resume: (_model, token, credential) => resumed(token, credential),
    discard: discarded,
  },
  synthesizer: {
    models: synthesisModels,
    open: (model, request, credential) =>
      request.language === undefined
        ? Effect.fail(SpeechFailure.invalidRequest('Soniox synthesis needs the language of the text'))
        : synthesisDuplex(synthesis(model, request, credential)),
  },
};
