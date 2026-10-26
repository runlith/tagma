import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import type { ThreadTypeRow, ThreadTypesPage } from '../contract/wire/birth.js';
import { evidenceText } from '../voice/threadText.js';
import type { EvidenceAnswer } from '../contract/wire/evidence.js';
import type { ThreadWireSnapshotPayload } from '../contract/wire/snapshot.js';
import { blockRefFlag } from '../../graph/cli/args.js';
import { refuse, noting, CurrentInvocation, print } from '../../platform/cli/verb.js';
import { createThread, locateThread, threadTurns, type ThreadsCli } from './turnVerbs.js';

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const project = Flag.String('project').pipe(
  Flag.optional,
  Flag.withMetavar('name|id'),
  Flag.withDescription('defaults to the project whose root contains the cwd'),
);
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

export const threadCommands = (cli: ThreadsCli) => {
  const { ask, lens } = cli;
  const { followThread } = threadTurns(cli);
  const newThread = Command.make(
    'new',
    {
      json,
      project,
      title: Flag.String('title').pipe(Flag.withDescription("the thread's name in the project list")),
      type: Flag.String('type').pipe(
        Flag.optional,
        Flag.withDescription('the agent this thread opens as — in code or declared in a file; omitted, tagma'),
      ),
      host: Flag.String('host').pipe(
        Flag.optional,
        Flag.withDescription('the host the thread is born against, as kind:id — a prepared sandbox: sandbox:<id>'),
      ),
      scope: blockRefFlag('scope').pipe(Flag.optional, Flag.withDescription('the block whose subtree the thread is opened inside')),
    },
    (input) =>
      Effect.gen(function* () {
        const scopeName = optional(input.scope);
        const type = optional(input.type);
        const host = hostOf(optional(input.host));
        const created = yield* Effect.flatMap(CurrentInvocation, (at) =>
          createThread(ask, lens(at, { project: optional(input.project) }), {
            title: input.title,
            ...(type === undefined ? {} : { type }),
            ...(host === undefined ? {} : { host }),
            ...(scopeName === undefined ? {} : { scopeName }),
          }),
        );
        yield* print(input.json ? created.snapshot.thread : created.snapshot.thread.id, input.json);
      }),
  ).pipe(Command.withDescription('open a thread without a first turn'));

  function hostOf(spelled: string | undefined): { kind: string; id: string } | undefined {
    if (spelled === undefined) return undefined;
    const at = spelled.indexOf(':');
    if (at <= 0 || at === spelled.length - 1) {
      return refuse('host-shape', `--host takes kind:id, not ${spelled}`, ['a prepared sandbox is sandbox:<id>']);
    }
    return { kind: spelled.slice(0, at), id: spelled.slice(at + 1) };
  }

  function installed(harness: ThreadTypeRow['harness']): string {
    if (harness === undefined) return '';
    if (harness.binary === null) return ` [unavailable: ${harness.missing ?? 'not found'}]`;
    return ` [${harness.binary}${harness.version === null ? `, version unread: ${harness.unreadable}` : `, ${harness.version}`}]`;
  }

  const refresh = Flag.Boolean('refresh').pipe(
    Flag.withDescription('read the login profile again and search every agent CLI anew'),
    Flag.withDefault(false),
  );
  const types = Command.make('types', { json, project, refresh }, (input) =>
    Effect.gen(function* () {
      const at = yield* CurrentInvocation;
      const page = (yield* ask((door) =>
        door.operations.perform({
          params: { id: 'list_thread_types' },
          query: lens(at, { project: optional(input.project) }),
          headers: {},
          payload: input.refresh ? { refresh: true } : {},
        }),
      )) as ThreadTypesPage & { readonly status: string };
      if (input.json) return yield* print(page, true);
      const lines = [
        ...page.types.map((type) => {
          const base = type.baseAgentId === type.id ? '' : ` (over ${type.baseAgentId})`;
          return `${type.id}${base} — ${type.description}${installed(type.harness)}`;
        }),
        ...page.rejected.map((file) => `rejected ${file.path}: ${file.reason}`),
      ];
      yield* print(lines.join('\n'), false);
    }),
  ).pipe(Command.withDescription('the agents a thread of this project may open as, and the agent files that could not be offered'));

  const set = Command.make(
    'set',
    {
      json,
      project,
      id: Argument.String('id'),
      title: Flag.String('title').pipe(Flag.optional, Flag.withDescription('rename it')),
      provider: Flag.String('provider').pipe(Flag.optional),
      model: Flag.String('model').pipe(Flag.optional),
      reasoning: Flag.String('reasoning').pipe(Flag.optional),
    },
    (input) =>
      Effect.gen(function* () {
        const query = lens(yield* CurrentInvocation, { project: optional(input.project) });
        const title = optional(input.title);
        const model = optional(input.model);
        const provider = optional(input.provider);
        if (title === undefined && model === undefined) {
          return refuse('nothing-to-set', 'name what changes', ['--title "<name>"', '--provider <p> --model <m> [--reasoning <r>]']);
        }
        if ((model === undefined) !== (provider === undefined)) {
          return refuse('model-pair', 'a model is named with its provider', ['--provider <p> --model <m>']);
        }
        let snapshot = null as { thread: { id: string; title: string } } | null;
        if (title !== undefined) {
          const renamed = (yield* ask((door) =>
            door.operations.perform({ params: { id: 'set_thread_title' }, query, headers: {}, payload: { threadId: input.id, title } }),
          )) as ThreadWireSnapshotPayload;
          snapshot = { thread: renamed.snapshot.thread };
        }
        if (model !== undefined && provider !== undefined) {
          const payload = { threadId: input.id, provider, model, reasoning: optional(input.reasoning) ?? null, switches: {} };
          snapshot = (
            (yield* ask((door) =>
              door.operations.perform({ params: { id: 'set_thread_model' }, query, headers: {}, payload }),
            )) as ThreadWireSnapshotPayload
          ).snapshot;
        }
        yield* print(input.json ? snapshot?.thread : `${input.id} ${snapshot?.thread.title ?? ''}`.trim(), input.json);
      }),
  ).pipe(Command.withDescription('rename a thread or move it to another provider and model'));

  const threads = Command.make('threads').pipe(
    Command.withDescription('operator thread birth, type inventory and direct edits'),
    Command.withSubcommands([newThread, types, set]),
  );

  const activity = Command.make(
    'activity',
    {
      json,
      project,
      id: Argument.String('id'),
      run: Flag.String('run').pipe(Flag.optional, Flag.withDescription('only what one run of this thread did — the id read_thread prints')),
    },
    (input) =>
      Effect.gen(function* () {
        const run = optional(input.run);
        const payload = {
          threadId: input.id,
          select: 'activity',
          where: run === undefined ? [] : [{ field: 'runId', op: 'eq', value: run }],
        };
        const { evidence } = (yield* ask((door, at) =>
          door.operations.perform({
            params: { id: 'read_thread' },
            query: lens(at, { project: optional(input.project) }),
            headers: {},
            payload,
          }),
        )) as { readonly evidence: EvidenceAnswer };
        yield* print(input.json ? evidence : evidenceText(evidence), input.json);
      }),
  ).pipe(
    Command.withDescription('what the product did over one thread: runs, model calls, tool calls and their outcomes'),
    noting('An activity whose outcome reads `open` is still going; `orphaned` was left open by a server that stopped.'),
  );

  const thread = Command.make(
    'thread',
    {
      json,
      project,
      id: Argument.String('id'),
      follow: Flag.Boolean('follow').pipe(
        Flag.withDefault(false),
        Flag.withDescription('stay attached and print the live feed; ends only when interrupted'),
      ),
      after: Flag.Int('after').pipe(Flag.optional, Flag.withDescription('feed entries strictly after this position')),
    },
    (input) =>
      Effect.gen(function* () {
        if (!input.follow) {
          return refuse('follow-required', 'the terminal thread reader follows the live socket', [
            `tagma thread ${input.id} --follow`,
            'read_thread — read the durable thread evidence instead',
          ]);
        }
        const projectId = yield* locateThread(ask, input.id);
        yield* followThread({
          projectId,
          threadId: input.id,
          since: optional(input.after),
          asJson: input.json,
        });
      }),
  ).pipe(Command.withDescription('follow one thread through its live socket'));
  return { threads, activity, thread };
};
