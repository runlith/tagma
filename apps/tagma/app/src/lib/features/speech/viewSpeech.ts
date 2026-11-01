import type { Line, ListeningEvent } from '@tagma/server/speech/contract/wire/listening';
import { SPEECH_NOTIFICATION, SpeechViewAsk } from '@tagma/server/speech/contract/wire/view';
import { Result, Schema, Stream } from 'effect';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection, ServerClient } from '$lib/wire/Live.js';
import type { LiveError } from '$lib/wire/liveFailure.js';
import type { SoundChannel } from '$lib/wire/SoundChannel.js';
import { INVALID_PARAMS, type ViewCall, type ViewMethod, ViewRefusal } from '../views/ViewBridge.js';
import { microphoneMissing, Sender } from './dictation/Sender.js';
import { Playback } from './Playback.js';

const decode = Schema.decodeUnknownResult(SpeechViewAsk);

type Held = {
  readonly id: string;
  readonly recognition: boolean;
  admitted: boolean;
  sender: Sender | null;
  release: () => void;
};

export const speechMethod = (door: Door, live: LiveConnection, sound: SoundChannel, projectId: number): ViewMethod => {
  const mounts = new WeakMap<AbortSignal, { feeds: Map<string, Held>; playback: Playback }>();
  const lens = { project: String(projectId) };
  return async (params, call) => {
    const decoded = decode(params, { onExcessProperty: 'error' });
    if (Result.isFailure(decoded)) throw new ViewRefusal(INVALID_PARAMS, decoded.failure.message);
    const ask = decoded.success;
    if (call.mounted.aborted || call.signal.aborted) throw new Error('the view was torn down');
    let mounted = mounts.get(call.mounted);
    if (mounted === undefined) {
      mounted = { feeds: new Map(), playback: new Playback(live) };
      mounts.set(call.mounted, mounted);
      const owned = mounted;
      call.mounted.addEventListener(
        'abort',
        () => {
          for (const row of owned.feeds.values()) row.release();
          owned.feeds.clear();
          owned.playback.silence();
        },
        { once: true },
      );
    }
    const held = mounted.feeds;
    switch (ask.action) {
      case 'status':
        return await door.perform('speech_status', {}, lens, { signal: call.signal });
      case 'speak': {
        const { action, ...input } = ask;
        return { status: 'spoken', ...(await mounted.playback.speak(input, call.signal)) };
      }
      case 'silence':
        return { status: 'stopped', voices: mounted.playback.silence() };
      case 'unsubscribe': {
        const row = ownedSubscription(held, ask.subscription);
        row.release();
        return {};
      }
      case 'finish': {
        const row = ownedSubscription(held, ask.subscription);
        if (!row.recognition) throw new ViewRefusal(INVALID_PARAMS, 'only a recognition can be finished');
        if (!row.admitted) throw new Error('wait for the live state before finishing recognition');
        row.sender?.end();
        return await door.perform('finish_recognition', { id: row.id }, lens, { signal: call.signal });
      }
      case 'recognize':
      case 'listening':
      case 'transcript':
        return await subscribe(door, live, sound, lens, held, ask, call);
    }
  };
};

const ownedSubscription = (held: Map<string, Held>, id: string): Held => {
  const row = held.get(id);
  if (row === undefined) throw new ViewRefusal(INVALID_PARAMS, 'unknown speech subscription');
  return row;
};

type SubscribeAsk = Extract<SpeechViewAsk, { readonly action: 'recognize' | 'listening' | 'transcript' }>;

async function subscribe(
  door: Door,
  live: LiveConnection,
  sound: SoundChannel,
  lens: { readonly project: string },
  held: Map<string, Held>,
  ask: SubscribeAsk,
  call: ViewCall,
): Promise<{ subscription: string }> {
  const id = crypto.randomUUID();
  let feed: { unsubscribe: () => void } | null = null;
  let completed = false;
  let opened = false;
  let openingError: Error | null = null;
  let offStatus = () => {};
  const row: Held = {
    id,
    recognition: ask.action === 'recognize',
    admitted: false,
    sender: null,
    release: () => {
      held.delete(id);
      feed?.unsubscribe();
      row.sender?.stop();
      offStatus();
      call.signal.removeEventListener('abort', row.release);
    },
  };
  held.set(id, row);
  call.signal.addEventListener('abort', row.release, { once: true });
  const fail = (failure: { readonly code: string; readonly reason: string; readonly unblock: readonly string[] }) => {
    if (!held.has(id)) return;
    if (opened) call.notify(SPEECH_NOTIFICATION, { subscription: id, failure });
    else openingError = new Error(failure.reason);
    row.release();
  };
  try {
    let open: (client: ServerClient) => Stream.Stream<ListeningEvent | Line, LiveError>;
    if (ask.action === 'recognize') {
      const status = await door.perform('speech_status', {}, lens, { signal: call.signal });
      if (status.status !== 'read') throw new Error(`the server answered ${status.status}`);
      if (!held.has(id)) throw new Error('the view was torn down');
      const at = status.speech.mic;
      if (at === 'caller') {
        const missing = microphoneMissing();
        if (missing !== null) throw new Error(missing.reason);
        row.sender = new Sender(sound, id, fail);
        if (!(await row.sender.start())) throw openingError ?? new Error('the browser microphone did not start');
        if (!held.has(id)) throw new Error('the view was torn down');
      }
      open = (client) =>
        client['speech.recognize']({
          id,
          tracks: [{ source: 'mic', at, echoCancel: true }],
          recognizer: ask.recognizer,
        });
    } else if (ask.action === 'listening') {
      open = (client) => client['speech.listening.subscribe']({ projectId: Number(lens.project), listening: ask.listening });
    } else {
      open = (client) =>
        client['speech.transcript.subscribe']({
          projectId: Number(lens.project),
          listening: ask.listening,
          after: ask.after,
        });
    }
    feed = live.hold<ListeningEvent | Line | null>(
      (client) => open(client).pipe(Stream.concat(Stream.succeed(null))),
      (event) => {
        if (!held.has(id)) return;
        if (event?.kind === 'state' && event.state === 'live') row.admitted = true;
        call.notify(SPEECH_NOTIFICATION, { subscription: id, event });
        if (event === null) {
          completed = true;
          row.release();
        }
      },
      (failure) =>
        fail({
          code: String(failure.code ?? failure.kind),
          reason: failure.message,
          unblock: failure.kind === 'subscription' ? (failure.unblock ?? []) : [],
        }),
      'feed',
      'once',
    );
    offStatus = live.subscribeStatus((status) => {
      if (status === 'paused' || status === 'refused' || status === 'closed') {
        fail({ code: 'speech-interrupted', reason: `the live connection is ${status}`, unblock: ['Start the speech subscription again.'] });
      }
    });
    if (!held.has(id)) {
      feed.unsubscribe();
      offStatus();
      if (!completed) throw openingError ?? new Error('the speech subscription ended before opening');
    } else row.sender?.connect();
    opened = true;
    call.signal.removeEventListener('abort', row.release);
    return { subscription: id };
  } catch (failure) {
    row.release();
    throw failure;
  }
}
