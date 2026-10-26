import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import type { ThreadMessageEntry } from '@runlith/agent/transcript/entries';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { ProjectLifecycle } from '../../graph/contract/service/serving.js';
import { ThreadJournal } from '../../threads/contract/service/engine.js';
import { ThreadRollouts } from '../../threads/contract/service/rollouts.js';
import { birthsOf, threadEntry } from '../../threads/testing/doubles.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import { makeRuntime } from '../runtime.js';
import { TESTING_ADAPTERS } from './adapters.js';
import { chosenModel } from './chosenModel.js';

export type RestartPlace = { readonly projectId: number; readonly threadId: string; readonly draft: string };
export type RestartDataset = {
  readonly places: readonly RestartPlace[];
  readonly historyMessages: number;
  readonly projects: number;
  readonly threads: number;
};

export const restartDataset = Effect.fn('restart.dataset')(
  function* (root: string, messages: number, previous?: RestartDataset) {
    const files = yield* FileSystem.FileSystem;
    const data = join(root, 'data');
    const runtime = yield* makeRuntime(
      {
        grants: testGrantSigner,
        databasePath: join(data, 'tagma.sqlite'),
        seedPath: join(root, 'seeds'),
        tokensPath: join(data, 'tokens.json'),
        attachmentsPath: join(data, 'attachments'),
        sourcePath: join(root, 'source'),
        drivers: [],
        adapters: TESTING_ADAPTERS,
      },
      Layer.empty,
      yield* sharedPool,
    );
    yield* chosenModel(runtime);
    const places: RestartPlace[] = previous === undefined ? [] : [...previous.places];
    if (previous === undefined) {
      for (let project = 0; project < 2; project++) {
        const checkout = join(root, `project-${project}`);
        yield* files.makeDirectory(checkout, { recursive: true });
        const born = yield* Context.get(runtime.graph, ProjectLifecycle)
          .create({ name: `history-${project}`, rootPath: checkout })
          .pipe(Effect.provide(runtime.graph));
        for (let thread = 0; thread < (project === 0 ? 2 : 1); thread++) {
          const child = yield* birthsOf(runtime.owners).create({
            projectId: born.id,
            createdBySessionId: null,
            title: `conversation-${thread}`,
          });
          places.push({ projectId: born.id, threadId: child.thread.id, draft: 'Keep the proposed change until its result is checked.' });
        }
      }
    }
    const store = Context.get(runtime.graph, MachineStore);
    const units = Context.get(runtime.graph, MachineUnits);
    const journal = Context.get(runtime.owners, ThreadJournal);
    for (const [index, place] of places.entries()) {
      const count = index === 0 ? messages : 1;
      const from = previous === undefined ? 0 : index === 0 ? previous.historyMessages : 1;
      for (let first = from; first < count; first += 64) {
        yield* units.write('fixture-history', (tx) =>
          Effect.gen(function* () {
            for (let ordinal = first; ordinal < Math.min(first + 64, count); ordinal++) {
              const entry: ThreadMessageEntry = {
                type: 'message',
                id: `${place.threadId}:message:${ordinal}`,
                role: ordinal % 2 === 0 ? 'user' : 'assistant',
                text: `Conversation ${index}, turn ${ordinal}: inspect the owning contract, preserve the pending draft, and verify the durable result before continuing. The next turn records the observed result and the remaining question.`,
                occurredAt: new Date(1_700_000_000_000 + ordinal * 1000).toISOString(),
              };
              yield* journal.append(
                { threadId: place.threadId, id: `${place.threadId}:event:${ordinal}`, kind: 'message', payload: { entry } },
                tx,
              );
              yield* tx.run(
                store.db
                  .insert(threadEntry())
                  .values({ threadId: place.threadId, ord: ordinal + 1, entryId: entry.id, type: entry.type, entry }),
              );
            }
          }),
        );
      }
    }
    yield* Context.get(runtime.owners, ThreadRollouts).exportStanding();
    return { places, historyMessages: messages, projects: 2, threads: places.length } satisfies RestartDataset;
  },
  Effect.provide(BunFileSystem.layer),
  Effect.scoped,
);
