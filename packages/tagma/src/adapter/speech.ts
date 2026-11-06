import type { SpeechProvider } from '@runlith/speech/protocol/adapter';
import type { AnyProvider } from '@runlith/speech/engine/catalog';
import type { SpeechHost } from '@runlith/speech/engine/SpeechSources';

export const defineSpeech = <Credential>(provider: SpeechProvider<Credential, SpeechHost>): AnyProvider<SpeechHost> => provider;
