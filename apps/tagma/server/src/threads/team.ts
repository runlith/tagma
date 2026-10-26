import { teamOf, type TeamLayer } from '@runlith/agent/collaboration/team';
import { Effect } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { Settings } from '../settings/contract/service/values.js';
import { ProviderAccounts } from '../providers/contract/service/accounts.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { ThreadMandate } from './contract/service/mandate.js';
import { ThreadTeams, type TeamLayers, type TeamPlace } from './contract/service/team.js';
import { teamModels, teamReview } from './contract/wire/settings.js';

export const makeThreadTeams = Effect.gen(function* () {
  const settings = yield* Settings;
  const mandate = yield* ThreadMandate;
  const registry = yield* ProviderRegistry;
  const accounts = yield* ProviderAccounts;

  const layers = Effect.fn('ThreadTeams.layers')(function* (place: TeamPlace) {
    const thread = place.threadId === null ? { own: null, nearest: null } : yield* mandate.teamLineage(place.threadId);
    const connected = yield* accounts.connected;
    const copy = place.copy ?? thread.nearest?.team;
    if (copy !== undefined) return { edits: copy.models, review: copy.review, thread, connected } satisfies TeamLayers;
    const edits = yield* settings.value(teamModels, place.projectId);
    const review = yield* settings.value(teamReview, place.projectId);
    return { edits, review, thread, connected } satisfies TeamLayers;
  });

  const adopting = Effect.fnUntraced(function* (promoted: TeamLayer | null, projectId: number, then: Effect.Effect<void, StoreFailure>) {
    const models = yield* settings.read(teamModels, projectId);
    const previous = {
      models: models.layers.project?.value ?? null,
      review: (yield* settings.read(teamReview, projectId)).layers.project?.value ?? null,
    };
    if (promoted === null) return { promoted, previous };
    const machine = models.layers.user?.value ?? [];
    const inherits = machine.length <= promoted.models.length && machine.every((edit, at) => Bun.deepEquals(edit, promoted.models[at]));
    const write = (key: string, value: unknown) => settings.write({ scope: 'project', projectId, key, value: value ?? undefined });
    const restore = Effect.andThen(write(teamModels.id, previous.models), write(teamReview.id, previous.review));
    yield* Effect.andThen(
      write(teamModels.id, inherits ? promoted.models.slice(machine.length) : promoted.models),
      write(teamReview.id, promoted.review),
    ).pipe(
      Effect.andThen(then),
      Effect.catch((failure) => Effect.andThen(restore, Effect.fail(failure))),
    );
    return { promoted, previous };
  });

  return ThreadTeams.of({
    layers,
    of: Effect.fn('ThreadTeams.of')(function* (place, given) {
      const { edits, review, connected } = given ?? (yield* layers(place));
      const catalog = (place.runId === undefined ? registry.current() : registry.forRun(place.runId)).models;
      return teamOf({ catalog, connected: connected.providers, edits, review });
    }),
    set: (threadId, team) => Effect.andThen(mandate.setTeam(threadId, team), mandate.teamLineage(threadId)),
    promote: Effect.fn('ThreadTeams.promote')(function* (threadId, projectId) {
      const promoted = (yield* mandate.teamLineage(threadId)).nearest?.team ?? null;
      return yield* adopting(promoted, projectId, mandate.setTeam(threadId, null));
    }),
    adopt: (team, projectId) => adopting(team, projectId, Effect.void).pipe(Effect.withSpan('ThreadTeams.adopt')),
  });
});
