import { Context, Effect, Layer } from 'effect';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { Pages } from '../browser/contract/service/pages.js';
import { NoticeTakeBack } from './contract/service/notices.js';
import { Custody } from './contract/service/custody.js';
import { ExecutionProcessEvidence } from './contract/service/records.js';
import { LoadFeed, WindowDeclarations } from './contract/service/load.js';
import { LoadOrigins } from './contract/service/owners.js';
import { TakeBackOpening } from './commands/waiters.js';
import { makeHostLoad, makeMachineLoad } from './load/feed.js';
import { partNames } from './load/windows.js';
import { makeWorkNames } from './load/work.js';
import { Background } from '../platform/contract/service/background.js';

export const executionsServingLayer = Layer.effectContext(
  Effect.gen(function* () {
    yield* (yield* TakeBackOpening).open(yield* NoticeTakeBack);
    const custody = yield* Custody;
    const unsubscribe = (yield* ProjectChanges).removed.subscribe(({ projectId }) => custody.disownProject(projectId));
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const evidence = yield* ExecutionProcessEvidence;
    const windows = yield* WindowDeclarations;
    const host = yield* makeHostLoad((parts) => evidence.load(process.pid, parts), windows);
    const names = partNames(windows, yield* Pages, yield* LoadOrigins);
    return Context.make(LoadFeed, yield* makeMachineLoad(host, yield* makeWorkNames, yield* Background, names));
  }),
);
