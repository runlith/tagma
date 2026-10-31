import { Effect } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { Projects } from '../../projects/contract/service/registry.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { ManagedCommands } from '../contract/service/commands.js';
import type { AppRef } from '../contract/service/load.js';
import { LoadAppTitles, LoadOwnerFacts, type OwnerFacts } from '../contract/service/owners.js';
import { Terminals } from '../contract/service/terminals.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import type { TerminalRecord } from '../contract/wire/terminals.js';

const FACTS_MS = 30_000;

export type Work = {
  readonly projectId: number;
  readonly project: string | undefined;
  readonly thread: ThreadId | undefined;
  readonly label: string;
  readonly kind: 'command' | 'terminal';
  readonly transport: 'pipes' | 'pty';
  readonly session: boolean;
  readonly since: number;
};

export type AppTitles = ReadonlyMap<string, string>;

export const appTitleKey = (view: AppRef): string => `${view.project}:${view.app}`;

export type Named = {
  readonly work: ReadonlyMap<string, Work>;
  readonly threads: ReadonlyMap<string, OwnerFacts>;
  readonly apps: AppTitles;
  readonly unread: string | undefined;
};

const titled = (text: string | undefined, fallback: string): string =>
  text
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? fallback;

const reasonOf = (failure: unknown): string =>
  typeof failure === 'object' && failure !== null && 'message' in failure && typeof failure.message === 'string'
    ? failure.message
    : String(failure);

export type WorkNames = Effect.Success<typeof makeWorkNames>;

export const makeWorkNames = Effect.gen(function* () {
  const managed = yield* ManagedCommands;
  const terminals = yield* Terminals;
  const owners = yield* LoadOwnerFacts;
  const registry = yield* Projects;
  const appTitles = yield* LoadAppTitles;
  const commands = new Map<string, CommandRecord | null>();
  const threads = new Map<string, OwnerFacts>();
  const projects = new Map<number, string | undefined>();
  const apps = new Map<number, ReadonlyMap<string, string>>();
  let factsAt = 0;

  return {
    read: Effect.fnUntraced(function* (refs: readonly ExecutionRef[], now: number, views: readonly AppRef[]): Effect.fn.Return<Named> {
      const problems: string[] = [];
      for (const ref of refs) {
        if (commands.has(ref.execution)) continue;
        const record = yield* Effect.result(managed.record(ref.execution, ref.incarnation));
        if (record._tag === 'Success') commands.set(ref.execution, record.success);
        else problems.push(`commands: ${reasonOf(record.failure)}`);
      }
      const held = refs.filter((ref) => commands.get(ref.execution) === null);
      let terminalRecords: ReadonlyMap<string, TerminalRecord> = new Map();
      if (held.length > 0) {
        const read = yield* Effect.result(terminals.recordsOf(held));
        if (read._tag === 'Success') terminalRecords = read.success;
        else problems.push(`terminals: ${reasonOf(read.failure)}`);
      }
      const work = new Map<string, Work>();
      for (const ref of refs) {
        const command = commands.get(ref.execution);
        if (command !== undefined && command !== null) {
          work.set(ref.execution, {
            projectId: command.projectId,
            project: undefined,
            thread: command.owner._tag === 'Thread' ? command.owner.thread : undefined,
            label: titled(command.label ?? command.commandLine ?? command.program, 'command'),
            kind: 'command',
            transport: 'pipes',
            session: false,
            since: command.admittedAt,
          });
          continue;
        }
        const terminal = terminalRecords.get(ref.execution);
        if (terminal === undefined) continue;
        work.set(ref.execution, {
          projectId: terminal.projectId,
          project: undefined,
          thread: terminal.heldBy ?? terminal.launchedFor,
          label: titled(terminal.label ?? terminal.commandLine ?? terminal.program, 'terminal'),
          kind: 'terminal',
          transport: terminal.transport,
          session: terminal.launchedFor !== undefined,
          since: terminal.acceptedAt,
        });
      }
      const stale = now - factsAt >= FACTS_MS;
      const shownThreads = [...new Set([...work.values()].flatMap((one) => (one.thread === undefined ? [] : [one.thread])))];
      const wanted = shownThreads.filter((thread) => stale || !threads.has(thread));
      if (wanted.length > 0) {
        const facts = yield* Effect.result(owners.read(wanted));
        if (facts._tag === 'Success') for (const thread of wanted) threads.set(thread, facts.success.get(thread) ?? { archived: false });
        else problems.push(`threads: ${facts.failure.reason}`);
      }
      const unnamed = [...new Set([...work.values()].map((one) => one.projectId))].filter((id) => stale || !projects.has(id));
      if (unnamed.length > 0) {
        const listed = yield* Effect.result(registry.list());
        if (listed._tag === 'Success') {
          const names = new Map(listed.success.map((row) => [row.id, row.name]));
          for (const projectId of unnamed) projects.set(projectId, names.get(projectId));
        } else problems.push(`projects: ${reasonOf(listed.failure)}`);
      }
      const shownApps = new Set(views.map((view) => view.project));
      for (const projectId of shownApps) {
        if (!stale && apps.has(projectId)) continue;
        const titles = yield* Effect.result(appTitles.read(projectId));
        if (titles._tag === 'Success') apps.set(projectId, titles.success);
        else {
          apps.delete(projectId);
          problems.push(`apps: ${titles.failure.reason}`);
        }
      }
      if (stale) {
        factsAt = now;
        for (const projectId of apps.keys()) if (!shownApps.has(projectId)) apps.delete(projectId);
        const shown = new Set<string>(shownThreads);
        const shownProjects = new Set([...work.values()].map((one) => one.projectId));
        for (const thread of threads.keys()) if (!shown.has(thread)) threads.delete(thread);
        for (const projectId of projects.keys()) if (!shownProjects.has(projectId)) projects.delete(projectId);
      }
      const named = new Map<string, Work>();
      for (const [execution, one] of work) named.set(execution, { ...one, project: projects.get(one.projectId) });
      const standing = new Set<string>(refs.map((ref) => ref.execution));
      for (const execution of commands.keys()) if (!standing.has(execution)) commands.delete(execution);
      const appNames = new Map<string, string>();
      for (const view of views) {
        const title = apps.get(view.project)?.get(view.app);
        if (title !== undefined) appNames.set(appTitleKey(view), title);
      }
      return { work: named, threads, apps: appNames, unread: problems.length === 0 ? undefined : problems.join('; ') };
    }),
  };
});
