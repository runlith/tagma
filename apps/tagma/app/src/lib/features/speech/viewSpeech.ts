import type { Heard, RecognizerAsk } from '@tagma/server/speech/contract/wire/listening';
import type { SpeakAsk } from '@tagma/server/speech/contract/wire/speaking';
import { Stream } from 'effect';
import type { CapabilityMount, CapabilityOwners } from '$lib/features/plugin-views/capabilities.js';
import { microphoneMissing, Sender } from './dictation/Sender.js';
import { Playback } from './Playback.js';

type SpeechListener = {
  readonly heard: (event: Heard) => void;
  readonly ended: (failure: string | null) => void;
};

type Recognition = {
  finish(): Promise<unknown>;
  stop(): void;
};

const LOST = new Set(['paused', 'refused', 'closed']);

export const viewSpeech = ({ door, live, sound }: CapabilityOwners, mount: CapabilityMount) => {
  const lens = { project: String(mount.projectId) };
  const playback = new Playback(live);
  const standing = new Set<() => void>();
  mount.ended.addEventListener(
    'abort',
    () => {
      playback.silence();
      for (const stop of [...standing]) stop();
    },
    { once: true },
  );

  const status = async () => {
    const read = await door.perform('speech_status', {}, lens, { signal: mount.ended });
    if (read.status !== 'read') throw new Error(`speech_status answered ${read.status}`);
    return read.speech;
  };

  const recognize = async (ask: { readonly recognizer?: RecognizerAsk }, listener: SpeechListener): Promise<Recognition> => {
    if (mount.ended.aborted) throw new Error('the view was unmounted');
    const at = (await status()).mic;
    const id = crypto.randomUUID();
    let admitted = false;
    let over = false;
    let sender: Sender | null = null;
    let held: { readonly unsubscribe: () => void } | null = null;
    let offStatus = () => {};
    const stop = (failure: string | null): void => {
      if (over) return;
      over = true;
      standing.delete(cut);
      held?.unsubscribe();
      offStatus();
      sender?.stop();
      listener.ended(failure);
    };
    const cut = () => stop(null);
    standing.add(cut);
    if (at === 'caller') {
      const missing = microphoneMissing();
      if (missing !== null) {
        stop(missing.reason);
        throw new Error(missing.reason);
      }
      sender = new Sender(sound, id, (failure) => stop(failure.reason));
      if (!(await sender.start()) || over) {
        stop('the browser microphone did not start');
        throw new Error('the browser microphone did not start');
      }
    }
    held = live.hold<Heard | null>(
      (client) =>
        client['speech.recognize']({ id, tracks: [{ source: 'mic', at, echoCancel: true }], recognizer: ask.recognizer }).pipe(
          Stream.concat(Stream.succeed(null)),
        ),
      (event) => {
        if (event === null) return stop(null);
        if (event.kind === 'state' && event.state === 'live') admitted = true;
        listener.heard(event);
      },
      (failure) => stop(failure.message),
      'feed',
      'once',
    );
    offStatus = live.subscribeStatus((now) => {
      if (LOST.has(now)) stop(`the live connection is ${now}`);
    });
    sender?.connect();
    return {
      finish: async () => {
        if (!admitted) throw new Error('wait for the live state before finishing recognition');
        sender?.end();
        return door.perform('finish_recognition', { id }, lens, { signal: mount.ended });
      },
      stop: cut,
    };
  };

  return {
    status,
    recognize,
    speak: (ask: SpeakAsk) => playback.speak(ask, mount.ended),
    silence: () => playback.silence(),
  };
};
