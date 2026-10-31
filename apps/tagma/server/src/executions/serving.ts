import { Context, Effect, Layer } from 'effect';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { NoticeTakeBack } from './contract/service/notices.js';
import { Custody } from './contract/service/custody.js';
import { ExecutionProcessEvidence } from './contract/service/records.js';
import { LoadFeed } from './contract/service/load.js';
import { TakeBackOpening } from './commands/waiters.js';
import { makeHostLoad, makeMachineLoad } from './load/feed.js';
import { makeWorkNames } from './load/work.js';
import { Background } from '../platform/contract/service/background.js';

export const executionsServingLayer = Layer.effectContext(
  Effect.gen(function* () {
    yield* (yield* TakeBackOpening).open(yield* NoticeTakeBack);
    const custody = yield* Custody;
    const unsubscribe = (yield* ProjectChanges).removed.subscribe(({ projectId }) => custody.disownProject(projectId));
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const evidence = yield* ExecutionProcessEvidence;
    const host = yield* makeHostLoad(Effect.suspend(() => evidence.load(process.pid, [])));
    return Context.make(LoadFeed, yield* makeMachineLoad(host, yield* makeWorkNames, yield* Background));
  }),
);
