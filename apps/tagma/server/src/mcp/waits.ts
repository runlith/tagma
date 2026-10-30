import { Effect, Layer, Semaphore, Stream } from 'effect';
import { Notifications } from '../notify/contract/service/notifications.js';
import { Senders } from '../notify/contract/service/senders.js';
import type { NotificationLink } from '../notify/contract/wire/notification.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { Projects } from '../projects/contract/service/registry.js';
import { McpServers } from './contract/service/servers.js';
import { MCP_SERVER_LINK, type McpServerLinkTarget } from './contract/wire/link.js';
import type { McpServerRow } from './contract/wire/servers.js';

export const MCP_SENDER = 'mcp';

type Wait = { readonly key: string; readonly title: string; readonly body: string; readonly link: NotificationLink };

type Waits = ReadonlyMap<string, Wait>;

const NONE: Waits = new Map();

const waitOf = (projectId: number, project: string, row: McpServerRow): Wait | null => {
  if (row.status !== 'needs-sign-in' && row.status !== 'needs-value') return null;
  const place = row.scope === 'user' ? `user/${row.name}` : `${projectId}/${row.scope}/${row.name}`;
  const target: McpServerLinkTarget = { projectId, scope: row.scope, name: row.name, contributor: row.contributor ?? null };
  const link: NotificationLink = { kind: MCP_SERVER_LINK, target };
  const whose = row.scope === 'user' ? 'Your MCP server' : `An MCP server of ${project}`;
  if (row.status === 'needs-sign-in') {
    return {
      key: `sign-in/${place}`,
      title: `Sign in to ${row.name}`,
      body: `${whose} waits for your sign-in; agents cannot use its tools until then.`,
      link,
    };
  }
  return {
    key: `value/${place}`,
    title: `${row.name} needs ${(row.needs ?? []).join(', ')}`,
    body: `${whose} waits for values only you can give; agents cannot use its tools until they are set.`,
    link,
  };
};

const quietly = <E>(work: Effect.Effect<void, E>): Effect.Effect<void> =>
  Effect.catch(work, (failure) => Effect.logWarning('the MCP servers waiting on the operator could not be shown', failure));

export const waitsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const servers = yield* McpServers;
    const notifications = yield* Notifications;
    const projects = yield* Projects;
    const senders = yield* Senders;
    const changes = yield* ProjectChanges;
    const serial = yield* Semaphore.make(1);
    const shown = new Map<number, Waits>();

    const show = Effect.fnUntraced(function* (projectId: number, now: Waits) {
      const before = shown.get(projectId) ?? NONE;
      const others = [...shown].flatMap(([id, waits]) => (id === projectId ? [] : [waits]));
      const elsewhere = (key: string): boolean => others.some((waits) => waits.has(key));
      for (const [key, wait] of now) {
        if (before.has(key) || elsewhere(key)) continue;
        yield* notifications.send(MCP_SENDER, { title: wait.title, body: wait.body, question: null, key, link: wait.link });
      }
      for (const key of before.keys()) if (!now.has(key) && !elsewhere(key)) yield* notifications.withdraw(MCP_SENDER, key);
      if (now.size === 0) shown.delete(projectId);
      else shown.set(projectId, now);
    });

    const read = Effect.fnUntraced(function* (projectId: number) {
      const rows = yield* servers.list(projectId);
      const project = yield* projects.byId(projectId).pipe(
        Effect.map((row) => row.name),
        Effect.catchTag('GateRefusal', () => Effect.succeed(`project ${projectId}`)),
      );
      const waits = rows.flatMap((row) => {
        const wait = waitOf(projectId, project, row);
        return wait === null ? [] : [[wait.key, wait] as const];
      });
      return new Map(waits);
    });

    const moved = Effect.fn('McpWaits.moved')(
      function* (projectId: number | null) {
        const open = new Set(servers.opened());
        const touched = new Set(projectId === null ? open : open.has(projectId) ? [projectId] : []);
        for (const standing of shown.keys()) if (!open.has(standing)) touched.add(standing);
        for (const id of touched) {
          const now = open.has(id)
            ? yield* read(id).pipe(
                Effect.tapError((failure) => Effect.logWarning('the MCP servers of a project could not be read', { id, failure })),
                Effect.orElseSucceed(() => shown.get(id) ?? NONE),
              )
            : NONE;
          yield* show(id, now);
        }
      },
      (effect) => serial.withPermit(effect),
    );

    yield* Effect.acquireRelease(
      Effect.sync(() => senders.register(MCP_SENDER, { deliver: () => Effect.void })),
      (release) => Effect.sync(release),
    );
    yield* quietly(notifications.withdraw(MCP_SENDER, null));
    yield* Effect.acquireRelease(
      Effect.sync(() => changes.removed.subscribe(({ projectId }) => quietly(serial.withPermit(show(projectId, NONE))))),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* Effect.forkScoped(
      Stream.runForEach(Stream.concat(Stream.succeed(null), servers.moves), (projectId) => quietly(moved(projectId))),
    );
  }),
);
