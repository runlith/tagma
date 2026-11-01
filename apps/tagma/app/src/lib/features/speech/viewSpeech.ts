import type { Heard } from '@tagma/server/speech/contract/wire/listening';
import { SPEECH_NOTIFICATION, SpeechViewAsk } from '@tagma/server/speech/contract/wire/view';
import { Result, Schema } from 'effect';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { SoundChannel } from '$lib/wire/SoundChannel.js';
import { INVALID_PARAMS, type ViewCall, type ViewMethod, ViewRefusal } from '../views/ViewBridge.js';
import { type FeedOpening, ViewFeeds } from '../views/ViewFeeds.js';
import { microphoneMissing, Sender } from './dictation/Sender.js';
import { Playback } from './Playback.js';

const decode = Schema.decodeUnknownResult(SpeechViewAsk);

type Recognition = { admitted: boolean; sender: Sender | null };

type RecognizeAsk = Extract<SpeechViewAsk, { readonly action: 'recognize' }>;

export const speechMethod = (door: Door, live: LiveConnection, sound: SoundChannel, projectId: number): ViewMethod => {
  const playbacks = new WeakMap<AbortSignal, Playback>();
  const feeds = new ViewFeeds<Recognition>(live, SPEECH_NOTIFICATION, 'speech');
  const lens = { project: String(projectId) };
  const playbackOf = (call: ViewCall): Playback => {
    const standing = playbacks.get(call.mounted);
    if (standing !== undefined) return standing;
    const playback = new Playback(live);
    playbacks.set(call.mounted, playback);
    call.mounted.addEventListener('abort', () => playback.silence(), { once: true });
    return playback;
  };
  const recognition = (ask: RecognizeAsk, call: ViewCall): FeedOpening<Recognition, Heard> => ({
    open: async (row, fail) => {
      const status = await door.perform('speech_status', {}, lens, { signal: call.signal });
      if (status.status !== 'read') throw new Error(`the server answered ${status.status}`);
      if (!row.standing()) throw new Error('the view was torn down');
      const at = status.speech.mic;
      if (at === 'caller') {
        const missing = microphoneMissing();
        if (missing !== null) throw new Error(missing.reason);
        row.state.sender = new Sender(sound, row.id, fail);
        if (!(await row.state.sender.start())) throw new Error('the browser microphone did not start');
        if (!row.standing()) throw new Error('the view was torn down');
      }
      return (client) =>
        client['speech.recognize']({ id: row.id, tracks: [{ source: 'mic', at, echoCancel: true }], recognizer: ask.recognizer });
    },
    seen: (row, event) => {
      if (event.kind === 'state' && event.state === 'live') row.state.admitted = true;
    },
    opened: (row) => row.state.sender?.connect(),
    released: (row) => row.state.sender?.stop(),
  });
  return async (params, call) => {
    const decoded = decode(params, { onExcessProperty: 'error' });
    if (Result.isFailure(decoded)) throw new ViewRefusal(INVALID_PARAMS, decoded.failure.message);
    const ask = decoded.success;
    if (call.mounted.aborted || call.signal.aborted) throw new Error('the view was torn down');
    switch (ask.action) {
      case 'status':
        return await door.perform('speech_status', {}, lens, { signal: call.signal });
      case 'speak': {
        const { action, ...input } = ask;
        return { status: 'spoken', ...(await playbackOf(call).speak(input, call.signal)) };
      }
      case 'silence':
        return { status: 'stopped', voices: playbackOf(call).silence() };
      case 'unsubscribe':
        feeds.owned(call, ask.subscription).release();
        return {};
      case 'finish': {
        const row = feeds.owned(call, ask.subscription);
        if (!row.state.admitted) throw new Error('wait for the live state before finishing recognition');
        row.state.sender?.end();
        return await door.perform('finish_recognition', { id: row.id }, lens, { signal: call.signal });
      }
      case 'recognize':
        return await feeds.subscribe(call, { admitted: false, sender: null }, recognition(ask, call));
    }
  };
};
