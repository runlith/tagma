import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { Effect } from 'effect';
import type { ActivityRecord } from '@runlith/activity/store/record';
import type { ThreadClockRange } from './select.js';

type Narrowed = { readonly active?: ThreadClockRange; readonly ids?: readonly string[] };

export function activeNarrowed<S extends Narrowed>(
  activity: ActivityRecord['Service'],
  projectId: number,
  selection: S,
): Effect.Effect<S, ThreadStorageFailed> {
  const window = selection.active;
  if (window === undefined) return Effect.succeed(selection);
  return Effect.gen(function* () {
    const active: string[] = [];
    let after: string | undefined;
    let reading: string | undefined;
    do {
      const page = yield* activity.threads({
        project: projectId,
        limit: 50,
        ids: selection.ids,
        after,
        reading,
        since: window.since?.getTime(),
        before: window.before?.getTime(),
      });
      active.push(...page.threads);
      after = page.after ?? undefined;
      reading = page.reading;
    } while (after !== undefined);
    const held = new Set(active);
    return { ...selection, ids: selection.ids === undefined ? active : selection.ids.filter((id) => held.has(id)) };
  }).pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'activity.threads', cause })));
}
