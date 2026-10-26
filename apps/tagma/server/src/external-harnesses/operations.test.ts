import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { forProject } from '../invocation/testing/call.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { ThreadList } from '../threads/contract/service/list.js';
import { ThreadRefused } from '../threads/contract/service/failure.js';
import { HarnessSpeech, ScreenAsks } from './contract/service/speech.js';
import { TransportSwitch } from './contract/service/transport.js';
import { harnessScreenRead, harnessSpoke, transportSet } from './operations.js';

const threadId = 'foreign-harness';
const home = 33;
const operator: Caller = { actor: { kind: 'operator' }, files: null };
const refused = () => Effect.fail(new ThreadRefused(threadId, home));
const unused = new Proxy(
  {},
  {
    get: () => {
      throw new Error('a refused act reached an unrelated owner');
    },
  },
);
const owners = Context.make(HarnessSpeech, HarnessSpeech.of({ speak: refused })).pipe(
  Context.add(ScreenAsks, ScreenAsks.of({ text: refused })),
  Context.add(TransportSwitch, TransportSwitch.of({ to: refused })),
  Context.add(ThreadRecords, unused as ThreadRecords['Service']),
  Context.add(ThreadList, unused as ThreadList['Service']),
);

const expectForeign = <A, E, R>(act: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.result(act), (result) => {
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'foreign-project', unblock: [`read it with project: ${home}`] } });
  }).pipe(forProject(Effect.succeed({ project: { id: 5, name: 'runlith' } })), Effect.provide(owners));

it.effect('harness operations preserve the foreign-project refusal and its recovery address', () =>
  Effect.gen(function* () {
    yield* expectForeign(harnessSpoke.body.execute({ threadId, text: 'continue' }, undefined, operator));
    yield* expectForeign(harnessScreenRead.body.execute({ threadId }, undefined, operator));
    yield* expectForeign(transportSet.body.execute({ threadId, transport: 'acp' }, [], operator));
  }),
);

it.effect('a profile transport refusal stays a declared outcome of the transport operation', () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(transportSet.body.execute({ threadId, transport: 'acp' }, [], operator)).pipe(
      forProject(Effect.succeed({ project: { id: home, name: 'polygon' } })),
      Effect.provide(
        owners.pipe(
          Context.add(
            TransportSwitch,
            TransportSwitch.of({
              to: () =>
                Effect.fail(new GateRefusal('profile-transport', 'This profile uses the terminal.', ['keep this thread on terminal'])),
            }),
          ),
        ),
      ),
    );
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'profile-transport' } });
  }),
);
