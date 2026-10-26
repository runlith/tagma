import type { SpeechProvider } from '@runlith/speech/protocol/adapter';
import { duplex } from '@runlith/speech/protocol/duplex';
import type { DuplexTransport } from '@runlith/speech/protocol/transport';
import { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import { Credential } from './credential.ts';
import { recognitionModels, synthesisModels } from './models.ts';
import { recognition } from './recognition.ts';
import { synthesis } from './synthesis.ts';

export const openai: SpeechProvider<Credential, DuplexTransport | HttpClient.HttpClient> = {
  id: 'openai',
  label: 'OpenAI',
  credential: { _tag: 'required', schema: Credential },
  egress: ['wss://api.openai.com', 'https://api.openai.com'],
  availability: () => Effect.succeed({ _tag: 'present' }),
  recognizer: {
    models: recognitionModels,
    stream: (model, request, credential) => duplex(recognition(model, request, credential)),
  },
  synthesizer: {
    models: synthesisModels,
    open: (model, request, credential) => synthesis(model, request, credential),
  },
};
