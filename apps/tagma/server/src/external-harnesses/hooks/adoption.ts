import { Data, Effect, FileSystem, Schema } from 'effect';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { GRANT_VARIABLE, SESSION_TOKEN_VARIABLE, TERMINAL_VARIABLE } from '../../platform/contract/service/credentials.js';
import { shellDigest } from '../../platform/credentials/grants.js';
import { HARNESSES } from '../contract/service/table.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import {
  adoptionKeptName,
  ANCESTRY_LIMIT,
  SETTLED_ADOPTION_REFUSALS,
  harnessAdoptedSchema,
  type HarnessAdopted,
} from '../contract/wire/adoption.js';
import { sessionIdOf } from '../adapter/payload.js';
import { HARNESS_HOOK_BYTES } from '../../threads/contract/wire/harness/observation.js';
import { HARNESS_STORAGE_VARIABLES } from '../../threads/contract/wire/harness/session.js';
import type { HookDelivery } from './delivery.js';
import type { Invocation } from '../../platform/cli/verb.js';

type Kept = { readonly _tag: 'Adopted'; readonly answer: HarnessAdopted } | { readonly _tag: 'Refused'; readonly code: string };

const keptFile = (at: Invocation, key: string): string => join(at.temporary, adoptionKeptName(key));

const keptSchema = Schema.Union([
  Schema.Struct({ shell: Schema.String, refused: Schema.String }),
  Schema.Struct({ shell: Schema.String, ...harnessAdoptedSchema.fields }),
]);
const decodeKept = Schema.decodeUnknownEffect(Schema.fromJsonString(keptSchema));

const readKept = Effect.fn('hookAdoption.readKept')(function* (
  at: Invocation,
  key: string,
  shell: string,
): Effect.fn.Return<Kept | null, never, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  return yield* files.readFileString(keptFile(at, key)).pipe(
    Effect.flatMap(decodeKept),
    Effect.map((kept): Kept | null => {
      if (kept.shell !== shellDigest(shell)) return null;
      if ('refused' in kept) return { _tag: 'Refused', code: kept.refused };
      return { _tag: 'Adopted', answer: { grant: kept.grant, session: kept.session, threadId: kept.threadId, job: kept.job } };
    }),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
    Effect.catch((cause) => Effect.as(Effect.logDebug('hook adoption cache could not be read', { cause }), null)),
  );
});

const keep = Effect.fn('hookAdoption.keep')(function* (
  at: Invocation,
  key: string,
  shell: string,
  kept: HarnessAdopted | { readonly refused: string },
) {
  const files = yield* FileSystem.FileSystem;
  const file = keptFile(at, key);
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  yield* files.writeFileString(tmp, JSON.stringify({ ...kept, shell: shellDigest(shell) }), { mode: 0o600 }).pipe(
    Effect.andThen(files.rename(tmp, file)),
    Effect.onError(() =>
      files
        .remove(tmp, { force: true })
        .pipe(Effect.catch((cause) => Effect.logDebug('hook adoption cache temporary could not be removed', { cause }))),
    ),
    Effect.uninterruptible,
    Effect.catch((cause) => Effect.logDebug('hook adoption answer could not be cached', { cause })),
  );
});

const granted = (at: Invocation, answer: HarnessAdopted): void => {
  at.env[GRANT_VARIABLE] = answer.grant;
  at.env[SESSION_TOKEN_VARIABLE] = answer.session;
};

class AncestryUnreadable extends Data.TaggedError('AncestryUnreadable')<{ readonly message: string; readonly cause: unknown }> {}

const ancestry = Effect.fn('hookAdoption.ancestry')(function* () {
  const text = yield* Effect.acquireUseRelease(
    Effect.try({
      try: () => Bun.spawn(['ps', '-A', '-o', 'pid=,ppid='], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' }),
      catch: (cause) => new AncestryUnreadable({ message: 'could not start the ancestry process', cause }),
    }),
    (child) =>
      Effect.tryPromise({
        try: async () => {
          const text = await new Response(child.stdout).text();
          await child.exited;
          return text;
        },
        catch: (cause) => new AncestryUnreadable({ message: 'could not read the ancestry process', cause }),
      }),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
      }),
  );
  const parents = new Map<number, number>();
  for (const line of text.split('\n')) {
    const [pid, parent] = line.trim().split(/\s+/).map(Number);
    if (pid !== undefined && parent !== undefined && Number.isSafeInteger(pid) && Number.isSafeInteger(parent)) parents.set(pid, parent);
  }
  const chain: number[] = [];
  for (let at: number | undefined = process.pid; at !== undefined && at > 1 && chain.length < ANCESTRY_LIMIT; at = parents.get(at)) {
    chain.push(at);
  }
  return chain;
});

export const publishedHarness = (at: Invocation, key: string): HarnessName | undefined =>
  HARNESSES.find((row) => row.variable !== undefined && at.env[row.variable]?.trim() === key)?.harness;

export const adoptedHook = Effect.fn('hookAdoption.adoptedHook')(function* (
  at: Invocation,
  delivery: HookDelivery['Service'],
  event: Record<string, unknown>,
  named: HarnessName | null,
  fresh: boolean,
) {
  if ((at.env[GRANT_VARIABLE] ?? '').trim().length > 0) return;
  const shell = (at.env[TERMINAL_VARIABLE] ?? '').trim();
  const key = sessionIdOf(event);
  if (shell === '' || key === null) return;
  const harness = named ?? publishedHarness(at, key);
  if (harness === undefined) return;
  const kept = fresh ? null : yield* readKept(at, key, shell);
  if (kept?._tag === 'Refused') return;
  if (kept !== null) return granted(at, kept.answer);
  const chain = yield* ancestry().pipe(
    Effect.catch((cause) => Effect.as(Effect.logDebug('hook adoption ancestry could not be read', { cause }), [])),
  );
  if (chain.length === 0) return;
  const cwd = typeof event.cwd === 'string' && event.cwd.length > 0 ? event.cwd : at.cwd;
  const landed = yield* delivery.send((door) =>
    door.harness.adopt({
      query: { cwd },
      payload: {
        shell,
        harness,
        key,
        ancestry: chain,
        machine: hostname(),
        cwd,
        storage: HARNESS_STORAGE_VARIABLES.flatMap((name) => {
          const value = at.env[name];
          return value === undefined || value.length > HARNESS_HOOK_BYTES ? [] : [{ name, value }];
        }),
      },
    }),
  );
  if (landed._tag === 'Refused' && SETTLED_ADOPTION_REFUSALS.includes(landed.code))
    return yield* keep(at, key, shell, { refused: landed.code });
  if (landed._tag !== 'Answered') return;
  yield* keep(at, key, shell, landed.value);
  granted(at, landed.value);
});

export const forgetAdoption = Effect.fn('hookAdoption.forgetAdoption')(function* (at: Invocation, event: Record<string, unknown>) {
  const key = sessionIdOf(event);
  const name = event.hook_event_name ?? event.hookEventName;
  if (key === null || typeof name !== 'string' || !HARNESSES.some((row) => row.hooks?.events.sessionEnd === name)) return;
  const files = yield* FileSystem.FileSystem;
  yield* files
    .remove(keptFile(at, key), { force: true })
    .pipe(Effect.catch((cause) => Effect.logDebug('ended hook adoption cache could not be removed', { cause })));
});
