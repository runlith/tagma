import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { Projects } from '../../projects/contract/service/registry.js';
import { ManagedCommands } from '../contract/service/commands.js';
import { LoadAppTitles, LoadOwnerFacts, OwnerFactsUnread } from '../contract/service/owners.js';
import { Terminals } from '../contract/service/terminals.js';
import type { TerminalRecord } from '../contract/wire/terminals.js';
import { makeWorkNames } from './work.js';

const ref: ExecutionRef = { installation: InstallationId.make('load'), execution: ExecutionId.make('dev-server'), incarnation: 1 };

const server = {
  projectId: 5,
  execution: ref,
  transport: 'pipes',
  lifetime: 'held',
  heldBy: '01a125fe-9260-7644-9a64-589c9bc19e19',
  label: 'Tagma site dev server (5194)',
  acceptedAt: 10,
} as unknown as TerminalRecord;

it.effect(
  'a held terminal on pipes is named by its terminal record and its stop goes to the terminal; app titles come per shown view, and a failed read drops the stale title and is reported on every reading',
  () =>
    Effect.gen(function* () {
      let listing = true;
      const names = yield* makeWorkNames.pipe(
        Effect.provide(
          Context.make(ManagedCommands, { record: () => Effect.succeed(null) } as unknown as ManagedCommands['Service']).pipe(
            Context.add(Terminals, {
              recordsOf: () => Effect.succeed(new Map([[ref.execution, server]])),
            } as unknown as Terminals['Service']),
            Context.add(LoadOwnerFacts, { read: () => Effect.succeed(new Map()) } as unknown as LoadOwnerFacts['Service']),
            Context.add(Projects, { list: () => Effect.succeed([{ id: 5, name: 'runlith' }]) } as unknown as Projects['Service']),
            Context.add(LoadAppTitles, {
              read: () =>
                listing ? Effect.succeed(new Map([['notes', 'Notes']])) : Effect.fail(new OwnerFactsUnread({ reason: 'unreadable' })),
            }),
          ),
        ),
      );
      const shown = [
        { project: 5, app: 'notes' },
        { project: 5, app: 'gone' },
      ];
      const named = yield* names.read([ref], 0, shown);
      expect(named.work.get(ref.execution)).toMatchObject({ kind: 'terminal', transport: 'pipes', label: 'Tagma site dev server (5194)' });
      expect([...named.apps]).toEqual([['5:notes', 'Notes']]);
      listing = false;
      for (const now of [60_000, 60_001]) {
        const failed = yield* names.read([ref], now, shown);
        expect([...failed.apps]).toEqual([]);
        expect(failed.unread).toContain('unreadable');
      }
    }),
);

it.effect('held work of a removed project stands without a project name and is no unread reading', () =>
  Effect.gen(function* () {
    const names = yield* makeWorkNames.pipe(
      Effect.provide(
        Context.make(ManagedCommands, { record: () => Effect.succeed(null) } as unknown as ManagedCommands['Service']).pipe(
          Context.add(Terminals, {
            recordsOf: () => Effect.succeed(new Map([[ref.execution, server]])),
          } as unknown as Terminals['Service']),
          Context.add(LoadOwnerFacts, { read: () => Effect.succeed(new Map()) } as unknown as LoadOwnerFacts['Service']),
          Context.add(Projects, { list: () => Effect.succeed([{ id: 8, name: 'global' }]) } as unknown as Projects['Service']),
          Context.add(LoadAppTitles, { read: () => Effect.succeed(new Map()) }),
        ),
      ),
    );
    const named = yield* names.read([ref], 0, []);
    expect(named.work.get(ref.execution)).toMatchObject({ projectId: 5, project: undefined, label: 'Tagma site dev server (5194)' });
    expect(named.unread).toBeUndefined();
  }),
);
