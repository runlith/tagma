import type { SpeakAsk, Synthesized, Voiced } from '@tagma/server/speech/contract/wire/speaking';
import { Stream } from 'effect';
import type { LiveConnection } from '$lib/wire/Live.js';

type Playing = { readonly stop: (failure: Error) => void };
type Sound = { readonly source: AudioBufferSourceNode; readonly ended: Promise<void>; readonly finish: () => void };

export class Playback {
  private playing: Playing | null = null;

  constructor(private readonly live: LiveConnection) {}

  speak(ask: SpeakAsk, signal: AbortSignal): Promise<Voiced> {
    this.silence();
    return new Promise<Voiced>((resolve, reject) => {
      const audio = new AudioContext();
      const sounds = new Set<Sound>();
      let voice: Extract<Synthesized, { kind: 'voice' }> | null = null;
      let through = 0;
      let heard = false;
      let closed = false;
      let held: { unsubscribe: () => void } | null = null;
      let offStatus = () => {};
      const cancelled = () => playing.stop(new Error('speech was cancelled'));
      const release = () => {
        closed = true;
        held?.unsubscribe();
        offStatus();
        signal.removeEventListener('abort', cancelled);
        for (const sound of sounds) {
          sound.source.stop();
          sound.source.disconnect();
          sound.finish();
        }
        sounds.clear();
        if (this.playing === playing) this.playing = null;
        return audio.close();
      };
      const playing: Playing = {
        stop: (failure) => {
          if (closed) return;
          void release().then(() => reject(failure), reject);
        },
      };
      this.playing = playing;
      signal.addEventListener('abort', cancelled, { once: true });
      const write = async (event: Synthesized | null): Promise<void> => {
        if (closed) return;
        try {
          if (event === null) {
            if (voice === null || !heard) throw new Error('synthesis returned no audio');
            await Promise.all([...sounds].map((sound) => sound.ended));
            if (closed) return;
            const chosen = voice;
            await release();
            resolve({ provider: chosen.provider, model: chosen.model, voice: chosen.voice });
            return;
          }
          if (event.kind === 'voice') {
            voice = event;
            return;
          }
          if (voice === null) throw new Error('synthesis returned audio before its format');
          const { rate, channels } = voice.format;
          if (event.pcm.byteLength % (channels * 2) !== 0) throw new Error('synthesis returned a partial audio frame');
          const frames = event.pcm.byteLength / (channels * 2);
          if (frames === 0) return;
          const buffer = audio.createBuffer(channels, frames, rate);
          const samples = new DataView(event.pcm.buffer, event.pcm.byteOffset, event.pcm.byteLength);
          for (let channel = 0; channel < channels; channel++) {
            const output = buffer.getChannelData(channel);
            for (let frame = 0; frame < frames; frame++) output[frame] = samples.getInt16((frame * channels + channel) * 2, true) / 32768;
          }
          const source = audio.createBufferSource();
          source.buffer = buffer;
          source.connect(audio.destination);
          const ended = Promise.withResolvers<void>();
          const sound: Sound = { source, ended: ended.promise, finish: () => ended.resolve() };
          source.onended = () => {
            sounds.delete(sound);
            source.disconnect();
            sound.finish();
          };
          const start = Math.max(through, audio.currentTime);
          source.start(start);
          sounds.add(sound);
          through = start + buffer.duration;
          heard = true;
          if (through - audio.currentTime > 2) await sounds.values().next().value!.ended;
        } catch (failure) {
          playing.stop(failure instanceof Error ? failure : new Error(String(failure)));
        }
      };
      const start = async () => {
        if (signal.aborted) return cancelled();
        if (audio.state === 'suspended') {
          if (!navigator.userActivation.hasBeenActive) throw new Error('speech playback needs a click in the view');
          await audio.resume();
        }
        if (closed) return;
        if (audio.state !== 'running') throw new Error('the browser did not start audio playback');
        held = this.live.hold<Synthesized | null>(
          (client) => client['speech.synthesize'](ask).pipe(Stream.concat(Stream.succeed(null))),
          write,
          (failure) => playing.stop(new Error(failure.message)),
          'feed',
          'once',
          'separate',
        );
        offStatus = this.live.subscribeStatus((status) => {
          if (status === 'paused' || status === 'closed' || status === 'refused')
            playing.stop(new Error(`the live connection is ${status}`));
        });
        if (closed) offStatus();
      };
      void start().catch((failure: unknown) => playing.stop(failure instanceof Error ? failure : new Error(String(failure))));
    });
  }

  silence(): number {
    const playing = this.playing;
    if (playing === null) return 0;
    playing.stop(new Error('speech was stopped'));
    return 1;
  }
}
