import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import type { ExecutionFeedItem } from '@runlith/executions/Executions';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions } from '@runlith/executions/Executions';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import { ExecutionId, InstallationId, HostRequestKey, type ExecutionState } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { ProjectRootsUnavailable } from '../../workspace/contract/wire/coverage.js';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import type { HostConnection } from '../host/connection.js';
import { makeTerminalExecutions, type CommandAdmitter } from './executionPort.js';
import type { CommandLaunch } from '../contract/service/commands.js';
import type { Discharge } from '../contract/service/discharge.js';
import type { ExecutionProcessEvidence } from '../contract/service/records.js';
import type { Terminals } from '../contract/service/terminals.js';
import type { TerminalWriting } from '../contract/service/writing.js';

const installation = InstallationId.make('inventory-refusal');

const portOver = Effect.fnUntraced(function* (terminals: Terminals['Service'], host: HostConnection, admit?: CommandAdmitter) {
  return makeTerminalExecutions({
    terminals,
    writing: undefined as unknown as TerminalWriting['Service'],
    evidence: undefined as unknown as ExecutionProcessEvidence['Service'],
    discharge: undefined as unknown as Discharge['Service'],
    host,
    caller: { actor: { _tag: 'Operator' }, projectId: 1, kind: 'host', root: '/' },
    scope: yield* Effect.scope,
    admit,
  });
});

const admitted: CommandAdmitter = () => Effect.succeed({ prepared: { targetKey: 'target' } } as unknown as CommandLaunch);

const launch = {
  lifetime: 'command',
  command: { program: 'bun', args: ['run', 'typecheck'], environment: [], cwd: '/' },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  purpose: 'command',
} as unknown as LaunchRequest;

it.effect('an inventory subscription is refused as discovery; a named state follow travels', () =>
  Effect.gen(function* () {
    const seen: string[] = [];
    const marker = { _tag: 'Ended', ending: 'completed' } as unknown as ExecutionFeedItem;
    const port = {
      subscribe: (source: { readonly _tag: string }) => {
        seen.push(source._tag);
        return Stream.make(marker);
      },
    } as unknown as ExecutionFeed['Service'];
    const ref = { installation, execution: ExecutionId.make('e-state'), incarnation: 0 };
    const owner = yield* portOver(undefined as unknown as Terminals['Service'], { port } as unknown as HostConnection);
    const refused = yield* Effect.flip(Stream.runCollect(owner.subscribe({ _tag: 'Inventory' }, 1)));
    const forwarded = yield* Stream.runCollect(owner.subscribe({ _tag: 'State', execution: ref }, 1));

    expect(refused).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'Unauthorized' } });
    expect(forwarded).toHaveLength(1);
    expect(seen).toEqual(['State']);
  }),
);

it.effect('a command accepted with no live state yet answers Accepted with its queued state', () =>
  Effect.gen(function* () {
    const ref = { installation, execution: ExecutionId.make('e-queued'), incarnation: 0 };
    const operation = { installation, operation: HostRequestKey.make('op-queued') };
    const queued = {
      ref,
      transport: 'pipes',
      lifetime: 'command',
      purpose: 'command',
      phase: 'queued',
      streams: { stdout: 'open', stderr: 'open', pty: 'open' },
      cleanup: 'pending',
      record: 'available',
    } satisfies ExecutionState;
    const port = {
      state: () => Effect.succeed(undefined),
      command: () => Effect.succeed({ state: queued }),
    } as unknown as Executions['Service'] & Commands['Service'];
    const terminals = {
      target: () => Effect.succeed({}),
      start: () => Effect.succeed({ _tag: 'Accepted', operation, record: { execution: ref } }),
    } as unknown as Terminals['Service'];
    const owner = yield* portOver(terminals, { port } as unknown as HostConnection, admitted);
    const started = yield* owner.start(operation, launch);

    expect(started._tag).toBe('Accepted');
    expect(started._tag === 'Accepted' ? started.state.phase : '').toBe('queued');
  }),
);

const startRefusedBy = Effect.fnUntraced(function* (refusal: TerminalRefused) {
  const ref = { installation, execution: ExecutionId.make('e-refused'), incarnation: 0 };
  const operation = { installation, operation: HostRequestKey.make('op-refused') };
  const port = {
    state: () => Effect.succeed(undefined),
    command: () => Effect.succeed(undefined),
  } as unknown as Executions['Service'] & Commands['Service'];
  const terminals = {
    target: () => Effect.succeed({}),
    start: () => Effect.succeed({ _tag: 'Refused', operation, refusal }),
    stop: () => Effect.fail(refusal),
    record: () => Effect.succeed({ projectId: 1, revision: 0, targetKey: 'target' }),
  } as unknown as Terminals['Service'];
  const owner = yield* portOver(terminals, { port } as unknown as HostConnection, admitted);
  const started = yield* owner.start(operation, launch);
  const stopped = yield* Effect.flip(owner.stop(operation, ref, 'explicit-stop', 'signal'));
  return { started, stopped };
});

it.effect('a floor refusal crosses the port under the host tag its reason owns, on the start and on the carried roads', () =>
  Effect.gen(function* () {
    const replacing = yield* startRefusedBy(
      new TerminalRefused({ reason: 'host-state', message: 'The host refused this launch: HostUnavailable — being replaced' }),
    );
    expect(replacing.started._tag).toBe('Refused');
    if (replacing.started._tag === 'Refused') {
      expect(replacing.started.refusal._tag).toBe('HostUnavailable');
      expect(replacing.started.refusal.reason).toContain('being replaced');
    }
    expect(replacing.stopped).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'HostUnavailable' } });

    const ceiling = yield* startRefusedBy(new TerminalRefused({ reason: 'capacity', message: 'no seat' }));
    expect(ceiling.started._tag === 'Refused' ? ceiling.started.refusal._tag : '').toBe('CapacityExceeded');

    const identity = yield* startRefusedBy(new TerminalRefused({ reason: 'ineligible', message: 'not placeable' }));
    expect(identity.started._tag === 'Refused' ? identity.started.refusal._tag : '').toBe('Unauthorized');
  }),
);

it.effect('a tool spawn whose project roots cannot be read crosses as unavailability, never as an authorization refusal', () =>
  Effect.gen(function* () {
    const operation = { installation, operation: HostRequestKey.make('op-roots') };
    const terminals = {
      target: () =>
        Effect.fail(
          new ProjectRootsUnavailable({ projectId: 1, reason: 'registry', message: 'Git could not list the checkouts of /repo' }),
        ),
    } as unknown as Terminals['Service'];
    const owner = yield* portOver(terminals, {} as unknown as HostConnection, admitted);
    const failure = yield* Effect.flip(owner.start(operation, launch));

    expect(failure).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'HostUnavailable' } });
    expect(failure._tag === 'HostRefused' ? failure.refusal.reason : '').toContain('Git could not list the checkouts of /repo');
  }),
);

it.effect('a floor that could not answer crosses as unavailability, never as a verdict on the caller', () =>
  Effect.gen(function* () {
    const operation = { installation, operation: HostRequestKey.make('op-silent') };
    const ref = { installation, execution: ExecutionId.make('e-silent'), incarnation: 0 };
    const terminals = {
      record: () => Effect.succeed({ projectId: 1, revision: 0, targetKey: 'target' }),
      stop: () => Effect.fail(new TerminalUnavailable({ owner: 'store', message: 'the store is closed' })),
    } as unknown as Terminals['Service'];
    const owner = yield* portOver(terminals, {} as unknown as HostConnection);
    const failure = yield* Effect.flip(owner.stop(operation, ref, 'explicit-stop', 'signal'));

    expect(failure).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'HostUnavailable', reason: 'the store is closed' } });
  }),
);
