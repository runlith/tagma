import type { PresenceMissingReason, PresenceRow } from '@tagma/server/threads/contract/wire/presence';
import { Cause, Effect, Exit } from 'effect';
import type { LinkPort } from '$lib/shared/ExternalLinks.js';
import type { ThreadPresence } from '$lib/features/presence/Presence.svelte.js';
import type { ShellPort } from '$lib/features/workspace/ShellOps.js';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { SoundChannel } from '$lib/wire/SoundChannel.js';
import { argumentsOf, needed, openLink } from '../views/params.js';
import { resourceSubscription } from '../views/resourceFeed.js';
import { INVALID_PARAMS, type ViewCall, type ViewHost, type ViewMethod, type ViewParams, ViewRefusal } from '../views/ViewBridge.js';
import { capabilityOf, HOST_METHODS, type HostMethod, type TagmaMethod, THREAD_CHANGED } from './methods.js';
import { sectionOpening } from './sectionOpen.js';
import type { ViewSets } from './ViewSets.svelte.js';

export type TagmaAppMount = {
  readonly projectId: number;
  readonly tagmaApp: string;
  readonly view: string;
  readonly threadId: string | null;
  readonly key: string | null;
};

export type TagmaAppHostOwners = {
  readonly door: Door;
  readonly live: LiveConnection;
  readonly sound: SoundChannel;
  readonly presence: ThreadPresence;
  readonly shell: ShellPort;
  readonly sets: ViewSets;
  readonly links: LinkPort;
  readonly methods: readonly TagmaMethod[];
};

export type ThreadReading =
  | {
      readonly threadId: string;
      readonly life: PresenceRow['status']['life'];
      readonly runId: string | null;
      readonly text: string | null;
      readonly ended: string | null;
    }
  | { readonly threadId: string; readonly missing: PresenceMissingReason };

const readingOf = (threadId: string, row: PresenceRow | undefined, missing: PresenceMissingReason | undefined): ThreadReading | null => {
  if (row === undefined) return missing === undefined ? null : { threadId, missing };
  return {
    threadId,
    life: row.status.life,
    runId: row.status.runId,
    text: row.tail?.text ?? row.saidLine,
    ended: row.status.runId === null ? (row.outcome?.status ?? null) : null,
  };
};

type Watched = { latest: ThreadReading | null; readonly ready: Promise<void>; readonly release: (reason: string) => void };

const watching = new WeakMap<AbortSignal, Map<string, Watched>>();

const unwatchThread = (threadId: string, call: ViewCall): object => {
  const held = watching.get(call.mounted);
  const watched = held?.get(threadId);
  if (watched === undefined) return { watched: false };
  held?.delete(threadId);
  watched.release('the view stopped watching the thread');
  return { watched: true };
};

const watchThread = async (presence: ThreadPresence, threadId: string, call: ViewCall): Promise<ThreadReading> => {
  if (call.mounted.aborted) throw new Error('the view was torn down');
  const held = watching.get(call.mounted) ?? new Map<string, Watched>();
  watching.set(call.mounted, held);
  const watched = held.get(threadId) ?? startWatch(presence, threadId, call);
  held.set(threadId, watched);
  await new Promise<void>((resolve, reject) => {
    const gone = () => reject(new Error('the request was cancelled'));
    if (call.signal.aborted) return gone();
    call.signal.addEventListener('abort', gone, { once: true });
    watched.ready.then(resolve, reject);
  });
  return watched.latest!;
};

const startWatch = (presence: ThreadPresence, threadId: string, call: ViewCall): Watched => {
  let opened: () => void = () => undefined;
  let refused: (failure: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    opened = resolve;
    refused = reject;
  });
  ready.catch(() => undefined);
  const hold = presence.watch([threadId]);
  const torn = () => release('the view was torn down');
  const release = (reason: string) => {
    call.mounted.removeEventListener('abort', torn);
    stop();
    hold.release();
    refused(new Error(reason));
  };
  const watched: Watched = { latest: null, ready, release };
  const stop = $effect.root(() => {
    $effect(() => {
      if (watched.latest === null && hold.set.problem !== null) refused(new Error(hold.set.problem));
      if (!hold.set.known) return;
      const now = readingOf(threadId, hold.set.row(threadId), hold.set.missing(threadId));
      if (now === null) return;
      const first = watched.latest === null;
      watched.latest = now;
      if (first) opened();
      else call.notify(THREAD_CHANGED, now);
    });
  });
  call.mounted.addEventListener('abort', torn, { once: true });
  return watched;
};

const shellAct = (act: Effect.Effect<void, { readonly message: string }>): Promise<object> =>
  Effect.runPromiseExit(act).then((exit) => {
    if (Exit.isSuccess(exit)) return {};
    const failure = Cause.squash(exit.cause);
    throw new Error(failure instanceof Error ? failure.message : String(failure));
  });

const answered = <A extends { readonly status: string }>(answer: A): Extract<A, { readonly status: 'ok' }> => {
  if (answer.status !== 'ok') throw new Error(`the server answered ${answer.status}`);
  return answer as Extract<A, { readonly status: 'ok' }>;
};

export function tagmaAppHost(owners: TagmaAppHostOwners, mount: TagmaAppMount): ViewHost {
  const { door, live, sound, presence, shell, sets, links, methods } = owners;
  const lens = { project: String(mount.projectId) };
  const at = { app: mount.tagmaApp, view: mount.view };
  const keyOf = (params: ViewParams): string => needed(params, 'key');
  const own: Record<HostMethod, ViewMethod> = {
    open: async (params) => {
      const place = sectionOpening(shell, sets, mount.tagmaApp, params);
      if (place !== null) return shellAct(place);
      const threadId = needed(params, 'threadId');
      if (params.beside !== undefined && typeof params.beside !== 'boolean') throw new ViewRefusal(INVALID_PARAMS, 'beside is a boolean');
      if (!navigator.userActivation.isActive) throw new Error('a thread opens only from a click in the view');
      return shellAct(shell.openThread({ projectId: mount.projectId, threadId }, params.beside === true ? 'beside' : 'main'));
    },
    'storage/get': async (params, { signal }) => {
      const read = answered(await door.perform('read_view_storage', { ...at, key: keyOf(params) }, lens, { signal }));
      return read.stored ? { stored: true, value: read.value } : { stored: false };
    },
    'storage/set': async (params, { signal }) => {
      const written = answered(
        await door.perform('write_view_storage', { ...at, key: keyOf(params), value: params.value }, lens, { signal }),
      );
      return { stored: written.stored };
    },
    thread: async (params, call) => watchThread(presence, needed(params, 'threadId'), call),
    'thread/unwatch': async (params, call) => unwatchThread(needed(params, 'threadId'), call),
  };
  const tagma: readonly (readonly [string, ViewMethod])[] = [
    ...HOST_METHODS.map((name) => [name, own[name]] as const),
    ...methods.map((declared) => [declared.name, declared.method({ door, live, sound }, mount)] as const),
  ];
  return {
    methods: {
      ...Object.fromEntries(tagma.map(([name, method]) => [`tagma/${name}`, method])),
      'tools/call': async (params, { signal }) =>
        answered(
          await door.perform(
            'call_app_tool',
            {
              ...at,
              tool: needed(params, 'name'),
              arguments: argumentsOf(params),
              threadId: mount.threadId ?? undefined,
            },
            lens,
            { signal },
          ),
        ).result,
      'resources/read': async (params, { signal }) => {
        const read = answered(await door.perform('read_app_resource', { ...at, uri: needed(params, 'uri') }, lens, { signal }));
        return { contents: read.contents, _meta: read._meta };
      },
      'ui/open-link': openLink(links),
      'ui/request-display-mode': async () => ({ mode: 'inline' }),
    },
    capabilities: Object.fromEntries(tagma.map(([name]) => [capabilityOf(name), {}])),
    subscribe: resourceSubscription(
      live,
      (uri) => (client) => client['views.resource.subscribe']({ projectId: mount.projectId, ...at, uri }),
    ),
    context: () => ({
      tagma: {
        projectId: mount.projectId,
        app: mount.tagmaApp,
        view: mount.view,
        ...(mount.key === null ? {} : { key: mount.key }),
        ...(mount.threadId === null ? {} : { threadId: mount.threadId }),
      },
    }),
  };
}
