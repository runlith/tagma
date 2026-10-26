import { Effect, Exit, Scope } from 'effect';
import type { Socket } from 'effect/socket/Socket';
import type { HelperAbsent } from '../helper/channel.ts';
import { clientAudio, controlFrame } from '../helper/frame.ts';
import { type HelperMessage, playbackWindowMs } from '../helper/messages.ts';
import { captureFormat, millisOf } from '../sound/format.ts';
import { ConformanceFailed, openProbe, type Probe, type Received } from './probe.ts';

export type Launched = { readonly socket: Socket; readonly exited: Effect.Effect<void> };
export type Launch = (token: string) => Effect.Effect<Launched, HelperAbsent, Scope.Scope>;

export const syntheticDevices = { tone: 'synthetic', gapped: 'synthetic-gap', absent: 'synthetic-absent' } as const;

type Of<T extends HelperMessage['type']> = Extract<HelperMessage, { readonly type: T }>;

const message =
  <T extends HelperMessage['type']>(type: T, id?: number) =>
  (received: Received): Of<T> | undefined => {
    if (received.kind !== 'message' || received.message.type !== type) return undefined;
    const found = received.message as Of<T>;
    return id === undefined || ('id' in found && found.id === id) ? found : undefined;
  };

const check = (step: string, holds: boolean, detail: string): Effect.Effect<void, ConformanceFailed> =>
  holds ? Effect.void : Effect.fail(new ConformanceFailed({ step, detail }));

const token = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

const PIECE = 1_600;

const audio = (id: number) => (received: Received) => (received.kind === 'audio' && received.audio.id === id ? received.audio : undefined);

const SECOND = 1_000_000_000n;

const capture = Effect.fnUntraced(function* (probe: Probe, id: number, other: number): Effect.fn.Return<void, ConformanceFailed> {
  const step = 'two captures, helper clock, stop with tail';
  yield* probe.send(step, { type: 'capture', id, source: 'mic', device: syntheticDevices.tone, echoCancel: false });
  yield* probe.send(step, { type: 'capture', id: other, source: 'system', device: syntheticDevices.tone, echoCancel: false });
  const ready = yield* probe.expect(step, message('ready', id));
  yield* check(step, ready.format !== undefined, 'a capture ready carries no format');
  yield* probe.expect(step, message('ready', other));
  const first = yield* probe.expect(step, audio(id));
  const hello = probe.helloNow() ?? 0n;
  const now = probe.helperNow() ?? 0n;
  yield* check(step, first.at >= hello - SECOND && first.at <= now + SECOND, `audio at ${first.at} is not on the hello clock near ${now}`);
  const counts = new Map([
    [id, 1],
    [other, 0],
  ]);
  yield* probe.expect(step, (received) => {
    if (received.kind !== 'audio' || !counts.has(received.audio.id)) return undefined;
    counts.set(received.audio.id, counts.get(received.audio.id)! + 1);
    return counts.get(id)! >= 3 && counts.get(other)! >= 3 ? true : undefined;
  });
  yield* probe.send(step, { type: 'stop', id });
  let last = first.pcm.length;
  const end = yield* probe.expect(step, (received) => {
    if (received.kind === 'audio' && received.audio.id === id) last = received.audio.pcm.length;
    return message('end', id)(received);
  });
  yield* check(step, end.reason === 'drained', `stop ended with ${end.reason}`);
  yield* check(step, last < first.pcm.length, 'stop ended without the partial chunk still pending at stop');
  yield* probe.expect(step, audio(other));
  yield* probe.send(step, { type: 'abort', id: other });
  yield* probe.expect(step, message('end', other));
  yield* probe.clean(step);
});

const gapThenAbort = Effect.fnUntraced(function* (probe: Probe, id: number): Effect.fn.Return<void, ConformanceFailed> {
  const step = 'gap and abort';
  yield* probe.send(step, { type: 'capture', id, source: 'mic', device: syntheticDevices.gapped, echoCancel: false });
  yield* probe.expect(step, message('ready', id));
  yield* probe.expect(step, message('gap', id));
  yield* probe.expect(step, audio(id));
  yield* probe.send(step, { type: 'abort', id });
  const end = yield* probe.expect(step, message('end', id));
  yield* check(step, end.reason === 'aborted', `abort ended with ${end.reason}`);
  yield* probe.clean(step);
});

const playback = Effect.fnUntraced(function* (probe: Probe, id: number): Effect.fn.Return<void, ConformanceFailed> {
  const step = 'playback with credit, clear and release';
  const pieceMs = millisOf(captureFormat, PIECE);
  let sent = 0;
  let played = 0;
  const counting =
    <A>(match: (received: Received) => A | undefined) =>
    (received: Received) => {
      const credit = message('played', id)(received);
      if (credit !== undefined) played += credit.ms;
      return match(received);
    };
  const settle = Effect.suspend(() =>
    played >= sent - 1
      ? Effect.void
      : Effect.asVoid(
          probe.expect(
            step,
            counting(() => (played >= sent - 1 ? true : undefined)),
          ),
        ),
  );
  const write = Effect.fnUntraced(function* (ms: number) {
    for (let done = 0; done < ms; done += pieceMs) {
      while (sent - played + pieceMs > playbackWindowMs) yield* probe.expect(step, counting(message('played', id)));
      yield* probe.bytes(step, clientAudio(id, new Int16Array(PIECE)));
      sent += pieceMs;
    }
  });

  yield* probe.send(step, { type: 'play', id, format: captureFormat });
  const ready = yield* probe.expect(step, message('ready', id));
  yield* check(step, ready.format === undefined, 'a player ready carries a format');
  yield* write(1_500);
  yield* probe.send(step, { type: 'mark', id, mark: 'spoken' });
  const spoken = yield* probe.expect(step, counting(message('marked', id)));
  yield* check(step, spoken.mark === 'spoken' && spoken.outcome === 'played', `mark ${spoken.mark} ${spoken.outcome}`);
  yield* settle;

  yield* write(800);
  yield* probe.send(step, { type: 'mark', id, mark: 'dropped' });
  yield* probe.send(step, { type: 'clear', id });
  const dropped = yield* probe.expect(step, counting(message('marked', id)));
  yield* check(step, dropped.mark === 'dropped' && dropped.outcome === 'cleared', `mark ${dropped.mark} ${dropped.outcome}`);
  yield* settle;

  yield* probe.send(step, { type: 'release', id });
  const end = yield* probe.expect(step, message('end', id));
  yield* check(step, end.reason === 'released', `release ended with ${end.reason}`);
  yield* probe.clean(step);
});

export const conformance = (launch: Launch): Effect.Effect<ReadonlyArray<string>, ConformanceFailed> =>
  Effect.acquireUseRelease(
    Scope.make(),
    (scope) => scenario(scope, launch),
    (scope) => Scope.close(scope, Exit.void),
  );

const scenario = Effect.fnUntraced(function* (
  scope: Scope.Closeable,
  launch: Launch,
): Effect.fn.Return<ReadonlyArray<string>, ConformanceFailed> {
  const passed: Array<string> = [];
  const pass = (step: string) => Effect.sync(() => void passed.push(step));
  const secret = token();
  const launched = yield* Scope.provide(launch(secret), scope).pipe(
    Effect.mapError((absent) => new ConformanceFailed({ step: 'launch', detail: absent.reason })),
  );
  const probe = yield* Scope.provide(openProbe(launched.socket), scope);

  const hello = yield* probe.expect('hello', (received) => {
    if (received.kind !== 'message') return undefined;
    return received.message.type === 'hello' ? received.message : { type: 'out-of-order' as const };
  });
  yield* check('hello', hello.type === 'hello' && hello.token === secret, 'the first message is not a hello with the token');
  yield* pass('hello');

  yield* probe.send('devices', { type: 'devices' });
  const devices = yield* probe.expect('devices', message('devices'));
  const ids = devices.list.map((device) => device.id);
  yield* check('devices', ids.includes(syntheticDevices.tone) && ids.includes(syntheticDevices.gapped), `inputs ${ids.join(', ')}`);
  yield* pass('devices');

  yield* probe.send('output', { type: 'output' });
  yield* probe.expect('output', message('output'));
  yield* pass('output');

  yield* probe.send('refusal', { type: 'capture', id: 1, source: 'mic', device: syntheticDevices.absent, echoCancel: false });
  const refused = yield* probe.expect('refusal', message('refused', 1));
  yield* check('refusal', refused.code === 'device-missing', `refused with ${refused.code}`);
  yield* pass('refusal');

  yield* capture(probe, 2, 6);
  yield* pass('two captures, helper clock, stop with tail');
  yield* gapThenAbort(probe, 3);
  yield* pass('gap and abort');
  yield* playback(probe, 4);
  yield* pass('playback with credit, clear and release');

  yield* probe.send('mute', { type: 'mute', id: 5 });
  yield* probe.expect('mute', message('ready', 5));
  yield* probe.send('mute', { type: 'mute', id: 7 });
  yield* probe.expect('mute', message('ready', 7));
  yield* probe.send('mute', { type: 'unmute', id: 5 });
  const unmuted = yield* probe.expect('mute', message('end', 5));
  yield* check('mute', unmuted.reason === 'released', `unmute ended with ${unmuted.reason}`);
  yield* pass('overlapping mute holders');

  yield* probe.bytes('unknown message', controlFrame({ type: 'conformance-unknown' }));
  const mismatch = yield* probe.expect('unknown message', message('refused'));
  yield* check('unknown message', mismatch.code === 'helper-mismatch' && mismatch.id === undefined, `refused ${mismatch.code}`);
  yield* probe.send('unknown message', { type: 'devices' });
  yield* probe.expect('unknown message', message('devices'));
  yield* probe.clean('unknown message');
  yield* pass('unknown message');

  yield* probe.send('eof with held resources', {
    type: 'capture',
    id: 8,
    source: 'mic',
    device: syntheticDevices.tone,
    echoCancel: false,
  });
  yield* probe.expect('eof with held resources', audio(8));
  yield* probe.send('eof with held resources', { type: 'play', id: 9, format: captureFormat });
  yield* probe.expect('eof with held resources', message('ready', 9));
  yield* probe.bytes('eof with held resources', clientAudio(9, new Int16Array(PIECE)));
  yield* Scope.close(scope, Exit.void);
  yield* launched.exited;
  yield* pass('eof with held resources');
  return passed;
});
