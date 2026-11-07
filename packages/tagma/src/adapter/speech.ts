import type { AnyProvider, SpeechHost, SpeechProvider } from '@runlith/speech/protocol/adapter';

export const defineSpeech = <Credential>(provider: SpeechProvider<Credential, SpeechHost>): AnyProvider<SpeechHost> => provider;
