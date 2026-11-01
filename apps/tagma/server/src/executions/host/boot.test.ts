import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import { WireUnavailable } from '@runlith/executions/Executions';
import type { CapabilityProfile, HostGrant } from '@runlith/executions/protocol/capacity';
import { InstallationId } from '@runlith/executions/protocol/execution';
import type { RuntimeStatus } from '@runlith/executions/protocol/runtime';
import type { AuthorityAnswer } from '@runlith/executions/protocol/wire';
import { grantHostShare, hostAdmission } from './boot.js';

const installation = InstallationId.make('host-share');

const MACHINE = 32 * 1024 * 1024 * 1024;

const grantOfShare = (share: number): HostGrant => ({
  share,
  machineBytes: MACHINE,
  grantBytes: Math.floor(share * MACHINE),
});

const profileGranted = (share: number): CapabilityProfile => ({ granted: grantOfShare(share) }) as unknown as CapabilityProfile;

const undeclared = <A>(verb: string): Effect.Effect<A, ExecutionsFailure> =>
  new WireUnavailable({ kind: 'unreachable', reason: `this fixture declares no answer for ${verb}`, sent: false });

type Scripted = {
  readonly port: HostAuthority['Service'] & HostLifecycle['Service'];
  readonly asked: () => readonly string[];
};

const hostThat = (world: { readonly welcome?: number; readonly grants?: ReadonlyArray<AuthorityAnswer> }): Scripted => {
  const asked: string[] = [];
  const grants = [...(world.grants ?? [])];
  const none = <A>(verb: string): Effect.Effect<A, ExecutionsFailure> => {
    asked.push(verb);
    return undeclared<A>(verb);
  };
  const port = {
    status: () => none<never>('status'),
    list: () => none<never>('list'),
    changes: () => none<never>('changes'),
    state: () => none<never>('state'),
    ending: () => none<never>('ending'),
    operation: () => none<never>('operation'),
    callResult: () => none<never>('callResult'),
    start: () => none<never>('start'),
    cancelStart: () => none<never>('cancelStart'),
    read: () => none<never>('read'),
    subscribe: () => Stream.fromEffect(undeclared<never>('subscribe')),
    screen: () => none<never>('screen'),
    input: () => none<never>('input'),
    signal: () => none<never>('signal'),
    processes: () => none<never>('processes'),
    listeners: () => none<never>('listeners'),
    hostListeners: () => none<never>('hostListeners'),
    capabilities: () => {
      asked.push('capabilities');
      return world.welcome === undefined ? undeclared<CapabilityProfile>('capabilities') : Effect.succeed(profileGranted(world.welcome));
    },
    custody: () => none<never>('custody'),
    stop: () => none<never>('stop'),
    take: () => none<never>('take'),
    fence: () => none<never>('fence'),
    release: () => none<never>('release'),
    grant: (_operation: unknown, share: number) => {
      asked.push(`grant:${share}`);
      const answer = grants.shift();
      return answer === undefined ? undeclared<AuthorityAnswer>('grant') : Effect.succeed(answer);
    },
    openBinding: () => none<never>('openBinding'),
    closeBinding: () => none<never>('closeBinding'),
    retire: () => none<never>('retire'),
    quiesce: () => none<never>('quiesce'),
    resume: () => none<never>('resume'),
    shutdown: () => none<never>('shutdown'),
  } as unknown as HostAuthority['Service'] & HostLifecycle['Service'];
  return { port, asked: () => asked };
};

const granted = (share: number, over = 0): AuthorityAnswer => ({
  _tag: 'Granted',
  granted: grantOfShare(share),
  reserved: 8_843_264,
  retained: 0,
  over,
});

const compare = (host: Scripted, held: number | undefined, share: number) =>
  grantHostShare({ installation, executions: host.port }, held, share);

it.effect('a host already holding the share is left alone: nothing is granted', () =>
  Effect.gen(function* () {
    const host = hostThat({ welcome: 0.25 });
    expect(yield* compare(host, undefined, 0.25)).toEqual({ _tag: 'Standing', share: 0.25 });
    expect(host.asked()).toEqual(['capabilities']);
  }),
);

it.effect('a host holding another share is granted the operator’s, and answers what its ledger stands at', () =>
  Effect.gen(function* () {
    const host = hostThat({ welcome: 0.25, grants: [granted(0.5)] });
    expect(yield* compare(host, undefined, 0.5)).toEqual({ _tag: 'Granted', share: 0.5, grantBytes: Math.floor(0.5 * MACHINE), over: 0 });
    expect(host.asked()).toEqual(['capabilities', 'grant:0.5']);
  }),
);

it.effect('every comparison after the first is against what the last Grant answered, not the welcome', () =>
  Effect.gen(function* () {
    const host = hostThat({ welcome: 0.25, grants: [granted(0.5), granted(0.25)] });
    const moved = yield* compare(host, undefined, 0.5);
    expect(moved._tag).toBe('Granted');

    const back = yield* compare(host, moved._tag === 'Granted' ? moved.share : undefined, 0.25);

    expect(back).toEqual({ _tag: 'Granted', share: 0.25, grantBytes: Math.floor(0.25 * MACHINE), over: 0 });
    expect(host.asked()).toEqual(['capabilities', 'grant:0.5', 'grant:0.25']);
  }),
);

it.effect('a grant below what the live terminals reserve is answered with the bytes standing over it', () =>
  Effect.gen(function* () {
    const host = hostThat({ welcome: 0.25, grants: [granted(0.01, 4_000_000)] });
    expect(yield* compare(host, 0.25, 0.01)).toEqual({
      _tag: 'Granted',
      share: 0.01,
      grantBytes: Math.floor(0.01 * MACHINE),
      over: 4_000_000,
    });
  }),
);

it.effect('a host that refuses the act is declined with its own reason, and the share is not believed held', () =>
  Effect.gen(function* () {
    const refusal: AuthorityAnswer = {
      _tag: 'Refused',
      refusal: { _tag: 'Unauthorized', reason: 'NotCustodian' },
    };
    const outcome = yield* compare(hostThat({ welcome: 0.25, grants: [refusal] }), 0.25, 0.5);

    expect(outcome._tag).toBe('Declined');
    if (outcome._tag === 'Declined') {
      expect(outcome.share).toBe(0.5);
      expect(outcome.detail).toContain('NotCustodian');
    }
  }),
);

it.effect('a host that cannot be reached at adoption is declined, never read as holding the share', () =>
  Effect.gen(function* () {
    const host = hostThat({});
    expect((yield* compare(host, undefined, 0.5))._tag).toBe('Declined');
    expect(host.asked()).toEqual(['capabilities']);
  }),
);

it.effect('an answer a grant never asks for is declined rather than believed', () =>
  Effect.gen(function* () {
    const bound: AuthorityAnswer = { _tag: 'Unbound', binding: 'binding-1' as never };
    const outcome = yield* compare(hostThat({ welcome: 0.25, grants: [bound] }), 0.25, 0.5);

    expect(outcome._tag).toBe('Declined');
    if (outcome._tag === 'Declined') expect(outcome.detail).toContain('Unbound');
  }),
);

const standingAt = (phase: RuntimeStatus['phase'], holder: RuntimeStatus['holder'] = { _tag: 'Standing' }): RuntimeStatus =>
  ({ installation, incarnation: 7, phase, holder, custody: { revision: 0, epoch: 0 } }) as unknown as RuntimeStatus;

it.effect('a generation whose holder is gone is read as ending, one whose channel broke is not', () =>
  Effect.gen(function* () {
    const gone = { _tag: 'Lost', loss: { reason: 'gone', detail: 'the holder closed its end of the channel' } } as const;
    const broken = { _tag: 'Lost', loss: { reason: 'broken', detail: 'the holder sent a frame of 0 bytes' } } as const;
    expect(yield* hostAdmission(Effect.succeed(standingAt('open', gone)))).toEqual({
      _tag: 'Orphaned',
      incarnation: 7,
      detail: 'the holder closed its end of the channel',
    });
    expect(yield* hostAdmission(Effect.succeed(standingAt('open', broken)))).toEqual({ _tag: 'Standing', incarnation: 7, phase: 'open' });
    expect(yield* hostAdmission(Effect.succeed(standingAt('stopping', gone)))).toEqual({ _tag: 'Closing', incarnation: 7, phase: 'stopping' });
  }),
);

it.effect('only a generation a shutdown has entered is read as ending, never one fenced for a hand-over', () =>
  Effect.gen(function* () {
    expect(yield* hostAdmission(Effect.succeed(standingAt('open')))).toEqual({ _tag: 'Standing', incarnation: 7, phase: 'open' });
    expect(yield* hostAdmission(Effect.succeed(standingAt('fenced')))).toEqual({ _tag: 'Standing', incarnation: 7, phase: 'fenced' });
    expect(yield* hostAdmission(Effect.succeed(standingAt('stopping')))).toEqual({ _tag: 'Closing', incarnation: 7, phase: 'stopping' });
    expect(yield* hostAdmission(Effect.succeed(standingAt('closed')))).toEqual({ _tag: 'Closing', incarnation: 7, phase: 'closed' });
    expect((yield* hostAdmission(undeclared<RuntimeStatus>('status')))._tag).toBe('Unread');
  }),
);
