import { Effect, Stream } from 'effect';
import { ContributionPoint } from '../platform/contract/service/contribution.js';
import { EnabledPlugins } from '../plugins/contract/service/plugins.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import type { PluginHiding, PluginListing } from './contract/service/listing.js';
import { LISTING_FACE, type ThreadsListing } from './contract/wire/listing.js';

const LISTING = new ContributionPoint<never, ThreadsListing>('threads/listing', LISTING_FACE);

export const makeListedPlugins = Effect.gen(function* () {
  const held = yield* (yield* PluginPoints).hold(LISTING);
  const enabled = yield* EnabledPlugins;
  const running = new Map<number, () => readonly string[]>();
  const subscribers = new Set<() => void>();

  const listed = (plugin: string): boolean => held.of(plugin)?.value.listed === true;
  const hiddenIn = (enabledIn: () => readonly string[]): readonly string[] => enabledIn().filter((plugin) => !listed(plugin));
  const signed = (): string =>
    [...running]
      .map(([project, plugins]) => `${project}:${[...hiddenIn(plugins)].sort().join(',')}`)
      .sort()
      .join(';');
  let signature = signed();

  const moved = (): void => {
    const now = signed();
    if (now === signature) return;
    signature = now;
    for (const subscriber of subscribers) subscriber();
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => held.changed(moved)),
    (leave) => Effect.sync(leave),
  );
  yield* Effect.forkScoped(Stream.runForEach(enabled.changes, () => Effect.sync(moved)));

  const hiding = Effect.fnUntraced(function* (projects: readonly number[]) {
    const found = new Map<number, ReadonlySet<string>>();
    for (const project of projects) {
      let plugins = running.get(project);
      if (plugins === undefined) {
        plugins = yield* enabled.held(project).pipe(Effect.orDie);
        running.set(project, plugins);
        signature = signed();
      }
      const hidden = hiddenIn(plugins);
      if (hidden.length > 0) found.set(project, new Set(hidden));
    }
    return found satisfies PluginHiding;
  });

  return {
    hiding,
    hides: (project, plugin) => {
      const plugins = running.get(project);
      return plugins !== undefined && plugins().includes(plugin) && !listed(plugin);
    },
    changed: (subscriber) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  } satisfies PluginListing;
});
