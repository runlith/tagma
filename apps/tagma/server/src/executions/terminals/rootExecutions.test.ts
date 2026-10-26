import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import { principalOf } from './principals.js';
import { type TerminalActor, type TerminalRecord } from '../contract/wire/terminals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { RootId, UseId } from '../../workspace/contract/wire/ids.js';
import type { RootUse } from '../../workspace/contract/wire/uses.js';
import type { CommandPreparation } from '../contract/service/access.js';
import { makeTerminalAccess } from './access.js';
import { rootExecutions, type StopKeyState } from './rootExecutions.js';
import type { TerminalDischarge } from '../contract/service/discharge.js';

const PROJECT = 7;

const ROOT = RootId.make('tree');

const OPERATOR: TerminalActor = { _tag: 'Operator' };

const thread = (id: string): TerminalActor => ({ _tag: 'Thread', threadId: ThreadId.make(id), projectId: PROJECT });

const FOREIGN: TerminalActor = { _tag: 'Foreign', harness: 'claude-code', key: 'session', projectId: PROJECT };

const use = (id: string, kind: 'terminal' | 'command' | 'sandbox'): RootUse =>
  ({ useId: UseId.make(id), consumer: { kind, id: `start-${id}` } }) as unknown as RootUse;

const terminal = (id: string, holder: TerminalActor, rootId: string | null = ROOT): TerminalRecord =>
  ({
    projectId: PROJECT,
    execution: { installation: 'inst', execution: `exec-${id}`, incarnation: 1 },
    targetKey: 'target-key',
    holder: principalOf(holder),
    origin: principalOf(holder),
    revision: 2,
    holdings: { rootUse: id },
    program: 'zsh',
    rootId: rootId ?? undefined,
  }) as unknown as TerminalRecord;

const command = (id: string, owner: CommandRecord['owner'], rootId: string | null = ROOT): CommandRecord =>
  ({
    projectId: PROJECT,
    execution: { installation: 'inst', execution: `exec-${id}`, incarnation: 1 },
    owner,
    targetKey: 'command-key',
    holdings: { rootUse: id },
    program: 'bun',
    rootId: rootId ?? undefined,
  }) as unknown as CommandRecord;

const byThread = (id: string): CommandRecord['owner'] => ({ _tag: 'Thread', thread: ThreadId.make(id) });

const stand = (
  held: { readonly terminals: readonly TerminalRecord[]; readonly commands: readonly CommandRecord[] },
  over: {
    readonly ended?: ReadonlySet<string>;
    readonly keys?: ReadonlyMap<string, StopKeyState>;
  } = {},
) => {
  const stops: TerminalOperationKey[] = [];
  const asked: string[] = [];
  const ending = rootExecutions({
    holding: () => Effect.succeed(held),
    access: makeTerminalAccess({ grants: {} as never, threads: {} as never }),
    commands: {
      prepare: (request) =>
        Effect.sync(() => {
          asked.push('execution' in request ? `${request.actor._tag}:${request.execution.execution}` : request._tag);
          return { request, targetKey: 'command-key' } as unknown as CommandPreparation;
        }),
      recheck: () => Effect.void,
    },
    ended: (_projectId, execution) =>
      Effect.succeed<TerminalDischarge>(
        over.ended?.has(execution.execution) === true ? { _tag: 'Discharged' } : { _tag: 'Retained', reason: 'unended' },
      ),
    key: (_projectId, operationId) => Effect.succeed(over.keys?.get(operationId) ?? 'free'),
    stop: (key) => Effect.sync(() => stops.push(key)),
    stopCommand: (key) => Effect.sync(() => stops.push(key)),
    now: () => 42,
  });
  return { ending, stops, asked };
};

describe('rootExecutions', () => {
  it.effect("the operator reaches a thread's terminal and command, and each stop carries the operator as its requester", () =>
    Effect.gen(function* () {
      const { ending, stops } = stand({ terminals: [terminal('t1', thread('a'))], commands: [command('c1', byThread('a'))] });
      const standing = yield* ending(PROJECT, ROOT, OPERATOR, [use('t1', 'terminal'), use('c1', 'command')]);
      expect(standing.map((one): unknown[] => [one.shown?.kind, one.unreachable])).toEqual([
        ['terminal', null],
        ['command', null],
      ]);
      yield* Effect.forEach(standing, (one, index) => one.end(`key-${index}`));
      expect(stops.map((key): string[] => [key.operationId, key.requester])).toEqual([
        ['key-0', 'operator'],
        ['key-1', 'operator'],
      ]);
    }),
  );

  it.effect('a thread or a foreign session ends what another holds, as its stop door allows', () =>
    Effect.gen(function* () {
      const held = {
        terminals: [terminal('own', thread('a')), terminal('theirs', OPERATOR), terminal('foreign', FOREIGN)],
        commands: [
          command('mine', byThread('a')),
          command('other', byThread('b')),
          command('service', { _tag: 'Service', scope: 'setup' }),
        ],
      };
      const uses = [
        use('own', 'terminal'),
        use('theirs', 'terminal'),
        use('foreign', 'terminal'),
        use('mine', 'command'),
        use('other', 'command'),
        use('service', 'command'),
        use('guest', 'sandbox'),
      ];
      for (const requester of [thread('a'), FOREIGN]) {
        const { ending, stops } = stand(held);
        const standing = yield* ending(PROJECT, ROOT, requester, uses);
        expect(standing.map((one): unknown[] => [one.use.useId, one.unreachable])).toEqual([
          ['own', null],
          ['theirs', null],
          ['foreign', null],
          ['mine', null],
          ['other', null],
          ['service', null],
          ['guest', 'unknown'],
        ]);
        yield* Effect.forEach(standing.slice(0, 6), (one) => one.end(`key-${one.use.useId}`));
        expect(stops.map((key): string => key.requester)).toEqual(Array(6).fill(principalOf(requester)));
      }
    }),
  );

  it.effect('an execution started outside the worktree refuses even the operator, since no dialog listed it', () =>
    Effect.gen(function* () {
      const { ending } = stand({ terminals: [terminal('home', OPERATOR, null)], commands: [command('main', byThread('a'), 'main')] });
      const standing = yield* ending(PROJECT, ROOT, OPERATOR, [use('home', 'terminal'), use('main', 'command')]);
      expect(standing.map((one) => one.unreachable)).toEqual(['started-elsewhere', 'started-elsewhere']);
    }),
  );

  it.effect('a stop already sent is not sent again, one never sent is sent under a fresh key, and one already discharged is not ours', () =>
    Effect.gen(function* () {
      const { ending, stops } = stand(
        {
          terminals: [terminal('t1', OPERATOR), terminal('t2', OPERATOR), terminal('t3', OPERATOR), terminal('t4', OPERATOR)],
          commands: [],
        },
        {
          ended: new Set(['exec-t2']),
          keys: new Map<string, StopKeyState>([
            ['key-t3', 'sent'],
            ['key-t4', 'unsent'],
          ]),
        },
      );
      const standing = yield* ending(
        PROJECT,
        ROOT,
        OPERATOR,
        ['t1', 't2', 't3', 't4'].map((id) => use(id, 'terminal')),
      );
      const ours = yield* Effect.forEach(standing, (one) => one.end(`key-${one.use.useId}`));
      expect(ours).toEqual([true, false, true, true]);
      expect(stops.map((key): string => key.operationId)).toEqual(['key-t1', 'key-t4:42']);
    }),
  );
});
