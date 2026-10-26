import { Effect, Result, type Scope } from 'effect';
import { SpeechFailure } from '../wire/failure.ts';
import type { Spoken, Synthesis } from './adapter.ts';
import type { SynthesisAct, SynthesisProtocol } from './codec.ts';
import { DuplexLimits } from './duplex.ts';
import { drive, type Step } from './link.ts';
import type { DuplexTransport } from './transport.ts';

const wholeFrames = (carry: Uint8Array, bytes: Uint8Array, frameBytes: number) => {
  const joined = new Uint8Array(carry.byteLength + bytes.byteLength);
  joined.set(carry, 0);
  joined.set(bytes, carry.byteLength);
  const whole = joined.byteLength - (joined.byteLength % frameBytes);
  const view = new DataView(joined.buffer, joined.byteOffset, whole);
  const pcm = new Int16Array(whole / 2);
  for (let index = 0; index < pcm.length; index++) pcm[index] = view.getInt16(index * 2, true);
  return { pcm, carry: joined.slice(whole) };
};

export const synthesisDuplex = Effect.fnUntraced(function* <State, Frame>(
  protocol: SynthesisProtocol<State, Frame>,
): Effect.fn.Return<Synthesis, never, Scope.Scope | DuplexTransport> {
  const limits = yield* DuplexLimits;
  const frameBytes = 2 * protocol.format.channels;
  let carry = new Uint8Array(0);
  const stepOf = (act: SynthesisAct<State>): Result.Result<Step<State, Spoken>, SpeechFailure> => {
    const out: Array<Spoken> = [];
    for (const bytes of act.audio) {
      const assembled = wholeFrames(carry, bytes, frameBytes);
      carry = assembled.carry;
      if (assembled.pcm.length > 0) out.push({ _tag: 'Audio', pcm: assembled.pcm });
    }
    if (act.marks.length > 0) out.push({ _tag: 'Marks', marks: act.marks });
    if (act.done && carry.byteLength > 0) return Result.fail(SpeechFailure.provider('the synthesis ended inside a frame', false));
    return Result.succeed({ state: act.state, send: act.send, out, done: act.done });
  };
  const link = yield* drive({
    request: protocol.request,
    init: protocol.init,
    initial: protocol.initial,
    decode: protocol.decode,
    step: (state, frame) => Result.flatMap(protocol.step(state, frame), stepOf),
    ready: protocol.ready,
    keepalive: protocol.keepalive,
    readyMs: limits.readyMs,
    bytesPerWeight: 1,
    ended: SpeechFailure.invalidRequest('the synthesis has ended'),
  });
  const synthesis: Synthesis = {
    format: protocol.format,
    say: (text) => link.act((state) => stepOf(protocol.say(state, text))),
    end: link.act((state) => stepOf(protocol.end(state)), true),
    audio: link.out,
  };
  return synthesis;
});
