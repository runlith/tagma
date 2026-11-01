import type { InstanceOf } from '@runlith/layer/key';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export type SpeakInput = {
  readonly text: string;
  readonly provider?: string;
  readonly model?: string;
  readonly voice?: string;
  readonly language?: string;
};

export const SpeechRepo = Repo.define(
  'speech',
  ({ single, mutation }) => ({
    status: single({
      loader: async ({ signal }, door) => (await door.perform('speech_status', {}, {}, { signal })).speech,
      refetchOnWindowFocus: false,
    }),

    install: mutation({
      mutator: async (model: string, { signal }, door) => (await door.perform('install_speech_model', { model }, {}, { signal })).status,
    }),

    remove: mutation({
      mutator: async (model: string, { signal }, door) => (await door.perform('remove_speech_model', { model }, {}, { signal })).status,
    }),

    speak: mutation({
      mutator: async (input: SpeakInput, { signal }, door) => door.perform('speak_text', input, {}, { signal }),
    }),

    stopSpeaking: mutation({
      mutator: async (_: void, { signal }, door) => (await door.perform('stop_speaking', {}, {}, { signal })).voices,
    }),
  }),
  { tier: 'app', door: Door },
);

export type SpeechRepo = InstanceOf<typeof SpeechRepo>;
