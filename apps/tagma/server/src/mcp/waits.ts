import { Effect, Layer, Semaphore, Stream } from 'effect';
import { Notifications } from '../notify/contract/service/notifications.js';
import { Senders } from '../notify/contract/service/senders.js';
import type { NotificationLink } from '../notify/contract/wire/notification.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { Projects } from '../projects/contract/service/registry.js';
import { McpServers } from './contract/service/servers.js';
import { MCP_SERVER_LINK, type McpServerLinkTarget } from './contract/wire/link.js';
import { type McpServerRow, mcpServerShown } from './contract/wire/servers.js';

export const MCP_SENDER = 'mcp';

type Wait = { readonly key: string; readonly title: string; readonly body: string; readonly link: NotificationLink };

const USER = 'user';
const SIGN_IN = 'sign-in';
const VALUE = 'value';

const placeOf = (projectId: number, row: McpServerRow): string =>
  row.scope === 'user' ? `${USER}/${row.name}` : `${projectId}/${row.scope}/${row.name}`;

const waitOf = (projectId: number, project: string, row: McpServerRow): Wait | null => {
  if (row.status !== 'needs-sign-in' && row.status !== 'needs-value') return null;
  const user = row.scope === 'user';
  const target: McpServerLinkTarget = {
    projectId: user ? null : projectId,
    scope: row.scope,
    name: row.name,
    contributor: row.contributor ?? null,
  };
  const link: NotificationLink = { kind: MCP_SERVER_LINK, target };
  const whose = user ? 'Your MCP server' : `An MCP server of ${project}`;
  const shown = mcpServerShown(row);
  if (row.status === 'needs-sign-in') {
    return {
      key: `${SIGN_IN}/${placeOf(projectId, row)}`,
      title: `Sign in to ${shown}`,
      body: `${whose} waits for your sign-in; agents cannot use its tools until then.`,
      link,
    };
  }
  return {
    key: `${VALUE}/${placeOf(projectId, row)}`,
    title: `${shown} needs ${(row.needs ?? []).join(', ')}`,
    body: `${whose} waits for values only you can give; agents cannot use its tools until they are set.`,
    link,
  };
};

const cut = (key: string): { readonly kind: string; readonly place: string } => {
  const at = key.indexOf('/');
  return { kind: key.slice(0, at), place: key.slice(at + 1) };
};

const endedIn = (projectId: number, rows: readonly McpServerRow[], keys: Iterable<string>): readonly string[] => {
  const standing = new Map(rows.map((row) => [placeOf(projectId, row), row]));
  return [...keys].filter((key) => {
    const { kind, place } = cut(key);
    if (!place.startsWith(`${projectId}/`)) return false;
    const row = standing.get(place);
    if (row === undefined || row.status === 'disabled' || row.status === 'declined') return true;
    return kind === VALUE && row.status !== 'needs-value';
  });
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
    const shown = new Map<number, ReadonlyMap<string, Wait>>();
    const known = new Set<number>();
    const delivered = new Set(yield* notifications.keys(MCP_SENDER));

    const covered = (key: string): boolean => {
      const place = cut(key).place;
      return place.startsWith(`${USER}/`) ? known.size > 0 : known.has(Number(place.slice(0, place.indexOf('/'))));
    };

    const reconcile = Effect.fnUntraced(function* (ended: ReadonlySet<string>) {
      const wanted = new Map<string, Wait>();
      for (const waits of shown.values()) for (const [key, wait] of waits) wanted.set(key, wait);
      for (const key of [...delivered]) {
        if (wanted.has(key) || !(covered(key) || ended.has(key))) continue;
        yield* quietly(Effect.tap(notifications.withdraw(MCP_SENDER, key), () => Effect.sync(() => delivered.delete(key))));
      }
      for (const [key, wait] of wanted) {
        if (delivered.has(key)) continue;
        const sent = notifications.send(MCP_SENDER, { title: wait.title, body: wait.body, question: null, key, link: wait.link });
        yield* quietly(Effect.tap(sent, () => Effect.sync(() => delivered.add(key))));
      }
    });

    const rowsOf = (projectId: number) =>
      servers.list(projectId).pipe(
        Effect.tapError((failure) => Effect.logWarning('the MCP servers of a project could not be read', { projectId, failure })),
        Effect.orElseSucceed(() => null),
      );

    const nameOf = (projectId: number) =>
      projects.byId(projectId).pipe(
        Effect.map((row) => row.name),
        Effect.orElseSucceed(() => `project ${projectId}`),
      );

    const moved = Effect.fn('McpWaits.moved')(
      function* (pulses: readonly (number | null)[]) {
        const open = new Set(servers.opened());
        const pulsed = new Set(pulses.includes(null) ? [...open, ...shown.keys()] : pulses.filter((id) => id !== null));
        for (const standing of shown.keys()) if (!open.has(standing)) pulsed.add(standing);
        const ended = new Set<string>();
        for (const id of pulsed) {
          const rows = yield* rowsOf(id);
          if (rows === null) continue;
          if (!open.has(id)) {
            shown.delete(id);
            for (const key of endedIn(id, rows, delivered)) ended.add(key);
            continue;
          }
          const project = yield* nameOf(id);
          known.add(id);
          shown.set(
            id,
            new Map(
              rows.flatMap((row) => {
                const wait = waitOf(id, project, row);
                return wait === null ? [] : [[wait.key, wait] as const];
              }),
            ),
          );
        }
        yield* reconcile(ended);
      },
      (effect) => serial.withPermit(effect),
    );

    const removed = Effect.fn('McpWaits.removed')(
      function* (projectId: number) {
        known.add(projectId);
        shown.delete(projectId);
        yield* reconcile(new Set());
      },
      (effect) => serial.withPermit(effect),
    );

    yield* Effect.acquireRelease(
      Effect.sync(() => senders.register(MCP_SENDER, { deliver: () => Effect.void })),
      (release) => Effect.sync(release),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => changes.removed.subscribe(({ projectId }) => removed(projectId))),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const moves = yield* servers.moves;
    yield* moved([null]);
    yield* Effect.forkScoped(Stream.runForEachArray(moves, moved));
  }),
);
