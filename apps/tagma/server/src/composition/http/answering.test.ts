import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Cause, Effect, Exit } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { answering } from './answering.js';

const answered = <A>(work: Effect.Effect<A, GateRefusal, never>) => Effect.exit(answering(work));

it.effect('a defect answers 500 carrying the refusal shape, never an empty body', () =>
  Effect.gen(function* () {
    const exit = yield* answered(Effect.die(new Error('the shipped workflows are gone')));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;

    const response = Cause.squash(exit.cause);
    expect(HttpServerResponse.isHttpServerResponse(response)).toBe(true);
    if (!HttpServerResponse.isHttpServerResponse(response)) return;
    expect(response.status).toBe(500);

    const body = yield* faultOf(response);
    expect(body.code).toBe('server-fault');
    expect(body.reason).toContain('the shipped workflows are gone');
    expect(body.unblock.length).toBeGreaterThan(0);
  }),
);

const faultOf = Effect.fnUntraced(function* (response: HttpServerResponse.HttpServerResponse) {
  return (yield* Effect.promise(() => HttpServerResponse.toWeb(response).json())) as {
    code: string;
    reason: string;
    unblock: string[];
    causes?: ReadonlyArray<{ tag: string; message: string }>;
  };
});

const died = Effect.fnUntraced(function* <A>(work: Effect.Effect<A, GateRefusal, never>) {
  const exit = yield* answered(work);
  if (!Exit.isFailure(exit)) return yield* Effect.die(new Error('expected a defect'));
  const response = Cause.squash(exit.cause);
  if (!HttpServerResponse.isHttpServerResponse(response)) return yield* Effect.die(new Error('expected a response to die with'));
  return yield* faultOf(response);
});

it.effect('a defect answers the chain that broke it, link by link', () =>
  Effect.gen(function* () {
    const plain = yield* died(Effect.die({ read: 'settings', code: 17 }));
    expect(plain.causes).toEqual([{ tag: 'Object', message: '{"read":"settings","code":17}' }]);
    expect(plain.reason).toContain('{"read":"settings","code":17}');

    const chained = yield* died(
      Effect.die(new Error('the settings could not be read', { cause: new TypeError('owners is not a function') })),
    );
    expect(chained.causes).toEqual([
      { tag: 'Error', message: 'the settings could not be read' },
      { tag: 'TypeError', message: 'owners is not a function' },
    ]);
  }),
);

it.effect('a gate refusal still leaves as the declared error, not as a fault', () =>
  Effect.gen(function* () {
    const exit = yield* answered(new GateRefusal('not-found', 'no such block', ['name one that exists']));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.squash(exit.cause)).toMatchObject({ code: 'not-found', unblock: ['name one that exists'] });
  }),
);
