import { Clock, Console, Data, Effect, FileSystem, Option, Schema } from 'effect';
import type { ToolShown } from '@runlith/agent/tool';
import { searchShown, shellShown } from '@runlith/agent-tools/shellShown';
import { resolve } from 'node:path';
import { GRANT_VARIABLE, SESSION_TOKEN_VARIABLE } from '../../platform/contract/service/credentials.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { inputEnvelopes, operatorWords } from '../adapter/input.js';
import { PERMISSION_TIMEOUT_SECONDS } from '../contract/wire/call.js';
import { HARNESS_DETAIL_MAX, HARNESS_ID_MAX, type FileEffect, type HarnessCall, type HarnessPrinted } from '@runlith/tagma/adapter/harness';
import type { HookCodec, HookMoment } from '@runlith/tagma/adapter/hook';
import { adoptedHook, forgetAdoption, hookSession, publishedHarness } from './adoption.js';
import { promptSupported, verdictOf } from '../adapter/hookFormat.js';
import type { HookRows } from './rows.js';
import {
  HARNESS_HOOK_BYTES,
  HARNESS_CALL_OUTPUT_MAX,
  type HarnessCallReport,
  type HarnessReceipt,
  type HarnessReportInput,
  type HarnessShell,
} from '../../threads/contract/wire/harness/observation.js';
import { makeHookDelivery, PERMISSION_RETRY_MS, type HookConnect, type HookDelivery } from './delivery.js';
import {
  dropPendingOp,
  hookPendingDir,
  keepPendingOp,
  keepRefusedOp,
  keepUnreadOp,
  listPendingOps,
  type HookWriteUnread,
  type PendingHookWrite,
  type RefusedHookWrite,
} from './pendingWrites.js';
import type { Invocation } from '../../platform/cli/verb.js';
import { hookCall } from './call.js';
import { baseFile, CREATION_MARKER, keepBase, dropBase, writtenTexts } from './base.js';

export type Road = {
  readonly at: Invocation;
  readonly temporary: string;
  readonly delivery: HookDelivery['Service'];
  readonly capturedAt: string;
  readonly receipt: string;
  readonly diagnostics: HarnessCallReport[];
  readonly named: HarnessAdapter | null;
  readonly rows: readonly HarnessAdapter[];
};

const HOOK_DOOR_KEYS = ['agent_id', 'source'] as const;

const callOf = (road: Road, event: Record<string, unknown>): HarnessCallReport | undefined =>
  road.named === null ? undefined : hookCall(road.named, event);

const cliOf = (road: Road, event: Record<string, unknown>, receipt?: HarnessReceipt): HarnessAdapter | undefined => {
  if (road.named !== null) return road.named;
  const key = hookSession(road, event);
  const published = key === null ? undefined : publishedHarness(road.at, road, key);
  return road.rows.find((row) => row.harness === (receipt?.harness ?? published));
};

const codecOf = (road: Road, event: Record<string, unknown>, receipt?: HarnessReceipt): HookCodec | undefined =>
  cliOf(road, event, receipt)?.hooks?.codec;

const printedOf = (road: Road, event: Record<string, unknown>): HarnessPrinted | null => {
  for (const row of road.rows) {
    const printed = row.printedOf(event);
    if (printed !== null) return printed;
  }
  return null;
};

const askingOf = (road: Road, event: Record<string, unknown>): { readonly row: HarnessAdapter; readonly call: HarnessCall } | null => {
  if (road.named !== null) {
    const call = road.named.subjectOf(event);
    return call === null ? null : { row: road.named, call };
  }
  for (const row of road.rows) {
    const call = row.subjectOf(event);
    if (call !== null && Object.hasOwn(row.tools.byName, call.tool.toLowerCase())) return { row, call };
  }
  return null;
};

class HookEventFailed extends Data.TaggedError('HookEventFailed')<{}> {
  override readonly message = 'hook event input failed';
}

const hookText = (at: Invocation) =>
  Effect.acquireUseRelease(
    Effect.sync(() => at.stdin().getReader()),
    (reader) =>
      Effect.gen(function* () {
        const chunks: Uint8Array[] = [];
        while (true) {
          const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: () => new HookEventFailed() });
          if (chunk.done) break;
          chunks.push(chunk.value);
        }
        return Buffer.concat(chunks).toString('utf8');
      }),
    (reader) =>
      Effect.tryPromise({ try: () => reader.cancel(), catch: () => new HookEventFailed() }).pipe(
        Effect.catchTag('HookEventFailed', () => Effect.void),
      ),
  ).pipe(Effect.timeoutOrElse({ duration: 10_000, orElse: () => Effect.fail(new HookEventFailed()) }), Effect.withSpan('hook.readEvent'));

const decodeEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));
const foreign = (road: Road, event: Record<string, unknown>): boolean => {
  const key = hookSession(road, event);
  const running = road.named === null || key === null ? undefined : publishedHarness(road.at, road, key);
  return running !== undefined && running !== road.named?.harness;
};

const parsedEvent = (road: Road, text: Effect.Effect<string, HookEventFailed>) =>
  text.pipe(
    Effect.flatMap(decodeEvent),
    Effect.map((event) => (foreign(road, event) ? undefined : event)),
    Effect.catchTags({ HookEventFailed: () => Effect.succeed(undefined), SchemaError: () => Effect.succeed(undefined) }),
  );

const hookEvent = (road: Road) => parsedEvent(road, hookText(road.at));

const eventCwd = (road: Road, event: Record<string, unknown>): string => (typeof event.cwd === 'string' ? event.cwd : road.at.cwd);

const harnessFiles = (road: Road, event: Record<string, unknown>): readonly FileEffect[] => {
  for (const row of road.rows) {
    const files = row.filesOf(event);
    if (files.length > 0) return files;
  }
  return [];
};

const fileEffects = (road: Road, event: Record<string, unknown>): readonly FileEffect[] => {
  const cwd = eventCwd(road, event);
  return harnessFiles(road, event).map((file) =>
    file.effect === 'move'
      ? { ...file, path: resolve(cwd, file.path), from: resolve(cwd, file.from) }
      : { ...file, path: resolve(cwd, file.path) },
  );
};

const sessionStart = Effect.fnUntraced(function* (road: Road) {
  const { delivery } = road;
  const event = yield* hookEvent(road);
  if (event === undefined) return;
  yield* adoptedHook(road.at, delivery, event, road, true);
  const cwd = eventCwd(road, event);
  const pending = sessionKey(road, event);
  if (pending !== null) yield* flushPending(road, pending, cwd);
  const receipt = yield* report(road, event, 'session-start');
  if (receipt?.transport === 'acp') return;
  const landed = yield* delivery.send((door) => door.orientation.sessionStart({ query: { cwd } }));
  const said = landed._tag === 'Answered' ? landed.value : '';
  const surface = cliOf(road, event, receipt)?.hooks ?? null;
  if (surface === null) return;
  const cap = surface.context.chars;
  const seed =
    receipt?.seeded === true
      ? yield* delivery.answered((door) =>
          door.harness.guide({ payload: { kind: 'seed', room: Math.max(0, cap - said.length - SEPARATOR.length) } }),
        )
      : undefined;
  const told = [said, seed?.text ?? ''].filter((part) => part.length > 0).join(SEPARATOR);
  if (told.length > 0) yield* Console.log(surface.codec.context(told));
});

const SEPARATOR = '\n\n';

const ungranted = (road: Road): boolean => (road.at.env[GRANT_VARIABLE] ?? '').trim().length === 0;

const sessionKey = (road: Road, event: Record<string, unknown>): string | null => {
  const id = hookSession(road, event);
  return id === null ? null : id.replace(/[^\w.-]/g, '');
};

const carried = (road: Road, event: Record<string, unknown>): Record<string, string> => {
  const bounded: Record<string, string> = {};
  for (const key of new Set([...road.rows.flatMap((row) => row.eventKeys), ...HOOK_DOOR_KEYS])) {
    const value = event[key];
    if (typeof value === 'string' && value.length <= HARNESS_ID_MAX) bounded[key] = value;
  }
  if (typeof event.transcript_path === 'string' && event.transcript_path.length <= HARNESS_HOOK_BYTES)
    bounded.transcript_path = event.transcript_path;
  if (typeof event.error === 'string' && event.error !== '') bounded.error = event.error.slice(0, HARNESS_DETAIL_MAX);
  return bounded;
};

const saying = (road: Road, event: Record<string, unknown>): Record<string, string> => {
  const said: Record<string, string> = {};
  for (const row of road.rows) {
    const key = row.answerKey;
    if (key === null) continue;
    const value = event[key];
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    said[key] = value.trim();
  }
  return said;
};

type Extras = {
  readonly inputs?: readonly string[];
  readonly prompt?: string;
  readonly call?: HarnessCallReport;
  readonly shell?: HarnessShell;
  readonly said?: Record<string, string>;
};

const report = Effect.fnUntraced(function* (
  road: Road,
  event: Record<string, unknown>,
  occasion: HarnessReportInput['occasion'],
  extras: Extras = {},
) {
  const { delivery } = road;
  if (ungranted(road)) return undefined;
  const forwarded = carried(road, event);
  if (Object.keys(forwarded).length === 0) return undefined;
  const session = (road.at.env[SESSION_TOKEN_VARIABLE] ?? '').trim();
  const { inputs = [], prompt, call, shell, said } = extras;
  const post = (door: Parameters<Parameters<typeof delivery.answered>[0]>[0]) =>
    door.harness.report({
      payload: {
        occasion,
        capturedAt: road.capturedAt,
        receipt: road.receipt,
        event: forwarded,
        sessionKey: hookSession(road, event) ?? undefined,
        inputs: inputs.length === 0 ? undefined : inputs,
        prompt: prompt === undefined || prompt === '' ? undefined : prompt,
        call,
        shell,
        diagnostics: road.diagnostics.length === 0 ? undefined : [...road.diagnostics],
        said: said === undefined || Object.keys(said).length === 0 ? undefined : said,
        session: session.length === 0 ? undefined : session,
      },
    });
  return yield* delivery.answered(post);
});

const observe = Effect.fnUntraced(function* (road: Road) {
  const event = yield* hookEvent(road);
  if (event === undefined) return;
  const eventName = event.hook_event_name ?? event.hookEventName;
  const prompt = road.rows.find((row) => row.promptKey !== undefined && row.hooks?.events.prompt === eventName);
  const text = prompt?.promptKey === undefined ? undefined : event[prompt.promptKey];
  yield* adoptedHook(road.at, road.delivery, event, road, false);
  if (ungranted(road)) return;
  const cwd = eventCwd(road, event);
  const session = sessionKey(road, event);
  const prepared = session === null ? undefined : yield* scanPending(road, session);
  const inputs = typeof text === 'string' ? inputEnvelopes(text) : [];
  const receipt = yield* report(road, event, 'self-description', {
    inputs,
    prompt: typeof text === 'string' ? operatorWords(text) : undefined,
    call: callOf(road, event),
  });
  if (session !== null) yield* flushPending(road, session, cwd, prepared);
  yield* guidePrompt(road, session, receipt, event, inputs);
  yield* forgetAdoption(road.at, road, event);
});

const guidePrompt = Effect.fnUntraced(function* (
  road: Road,
  session: string | null,
  receipt: HarnessReceipt | undefined,
  event: Record<string, unknown>,
  inputs: readonly string[],
) {
  if (receipt === undefined || receipt.transport === 'acp') return;
  const adapter = cliOf(road, event, receipt);
  const answering = adapter?.hooks?.codec.prompt ?? null;
  if (adapter === undefined || answering === null || !promptSupported(adapter.hooks)) return;
  const name = event.hook_event_name ?? event.hookEventName;
  const occasion = adapter.occasionOf({
    name: typeof name === 'string' ? name : '',
    tool: typeof event.toolName === 'string' ? event.toolName : typeof event.tool_name === 'string' ? event.tool_name : undefined,
    notification: typeof event.notification_type === 'string' ? event.notification_type : undefined,
  });
  if (occasion !== 'turn-start' || session === null) return;
  const evidence = `prompt:${session}:${new Bun.CryptoHasher('sha256').update(JSON.stringify(event)).digest('hex').slice(0, 32)}`;
  const guided = yield* road.delivery.idempotent((door) =>
    door.harness.guide({ payload: { kind: 'prompt', evidence, inputs: inputs.length === 0 ? [evidence] : inputs } }),
  );
  if (guided === undefined || guided.text === null) return;
  yield* Console.log(answering(guided.text));
});

type PendingDelivery = { readonly ops: readonly PendingHookWrite[]; readonly notices: readonly string[] };

const scanPending = Effect.fn('hook.scanPending')(function* (road: Road, session: string) {
  const dir = hookPendingDir(road.temporary, session);
  const read = listPendingOps(dir);
  const notices: string[] = [];
  for (const failure of read.unread) notices.push(yield* unreadWrite(road, dir, failure));
  return { ops: read.ops, notices };
});

const flushPending = Effect.fn('hook.flushPending')(function* (road: Road, session: string, cwd: string, prepared?: PendingDelivery) {
  const read = prepared ?? (yield* scanPending(road, session));
  const notices: string[] = [...read.notices];
  const dir = hookPendingDir(road.temporary, session);
  for (const op of read.ops) {
    const landed = yield* road.delivery.send((door) =>
      door.changes.record({
        query: { cwd },
        payload: { cwd, path: op.path, before: op.before, after: op.after, key: op.key },
      }),
    );
    if (landed._tag === 'Refused') {
      const notice = yield* refusedWrite(road, session, { ...op, refusal: { code: landed.code, reason: landed.reason } });
      notices.push(notice);
      continue;
    }
    if (landed._tag !== 'Answered') continue;
    dropPendingOp(dir, op.key);
    yield* dropBaseFor(road.temporary, session, op);
  }
  return notices;
});

const refusalText = (op: RefusedHookWrite): string => `record_write refused for ${op.path}: ${op.refusal.code}: ${op.refusal.reason}`;

const refusedWrite = Effect.fn('hook.refusedWrite')(function* (road: Road, session: string, op: RefusedHookWrite) {
  const dir = hookPendingDir(road.temporary, session);
  const kept = keepRefusedOp(dir, op);
  const notice = `${refusalText(op)}\n${kept === undefined ? `The refusal could not be saved; the captured write remains under ${dir}, and its delivery state could not be settled.` : `Write evidence kept under ${kept}; this refused report is not retried automatically.`}`;
  yield* writeNotice(road, op.key, op.path, notice);
  if (kept !== undefined) {
    if (kept !== dir) dropPendingOp(dir, op.key);
    yield* dropBaseFor(road.temporary, session, op);
  }
  return notice;
});

const unreadWrite = Effect.fn('hook.unreadWrite')(function* (road: Road, dir: string, failure: HookWriteUnread) {
  const kept = keepUnreadOp(dir, failure);
  const notice = `hook-write-unread for ${failure.path}: ${failure.operation}: ${failure.code}: ${failure.reason}\n${kept === undefined ? 'The read-failure record could not be saved.' : `Read-failure evidence kept at ${kept}.`} The source is left at ${failure.path}.`;
  yield* writeNotice(road, failure.key, failure.path, notice);
  return notice;
});

const writeNotice = Effect.fnUntraced(function* (road: Road, key: string, path: string, notice: string) {
  yield* Console.error(notice);
  road.diagnostics.push({
    id: key,
    tool: 'record_write',
    subject: path.slice(0, 1000),
    done: true,
    failed: true,
    output: notice.slice(0, HARNESS_CALL_OUTPUT_MAX),
  });
});

const dropBaseFor = Effect.fn('hook.dropBaseFor')(
  function* (temporary: string, session: string, op: PendingHookWrite) {
    const files = yield* FileSystem.FileSystem;
    const at = baseFile(temporary, session, op.base);
    const standing = yield* files
      .stat(at)
      .pipe(Effect.catchReason('PlatformError', 'NotFound', () => files.stat(`${at}${CREATION_MARKER}`)));
    if (Option.isSome(standing.mtime) && standing.mtime.value.getTime() <= Date.parse(op.capturedAt)) dropBase(temporary, session, op.base);
  },
  Effect.catchReason('PlatformError', 'NotFound', () => Effect.void),
  Effect.catch((failure) => Effect.logDebug('The settled hook write kept its captured base because its age could not be read', failure)),
);

const toolSaid = (
  road: Road,
  event: Record<string, unknown>,
  receipt: HarnessReceipt | undefined,
  said: readonly string[],
  moment: HookMoment,
) => {
  const codec = codecOf(road, event, receipt);
  return said.length === 0 || codec === undefined ? Effect.void : Console.log(codec.tool(said.join('\n\n'), moment));
};

const preToolUse = Effect.fn('hook.preToolUse')(function* (road: Road) {
  const event = yield* hookEvent(road);
  if (event === undefined) return;
  yield* adoptedHook(road.at, road.delivery, event, road, false);
  if (ungranted(road)) return;
  const session = sessionKey(road, event);
  if (session !== null) {
    for (const file of fileEffects(road, event)) {
      if (file.effect === 'read') continue;
      keepBase(road, session, file.effect === 'move' ? file.from : file.path);
    }
  }
  const prepared = session === null ? undefined : yield* scanPending(road, session);
  const printed = printedOf(road, event);
  const cwd = eventCwd(road, event);
  const shell = printed?._tag === 'Shell' && printed.command !== '' && cwd !== '' ? { command: printed.command, cwd } : undefined;
  const receipt = yield* report(road, event, 'activity', { call: callOf(road, event), shell });
  if (session === null) return;
  const notices = yield* flushPending(road, session, eventCwd(road, event), prepared);
  yield* toolSaid(road, event, receipt, notices, 'before');
});

const postToolUse = Effect.fn('hook.postToolUse')(function* (road: Road) {
  const files = yield* FileSystem.FileSystem;
  const isFile = (path: string) =>
    files.stat(path).pipe(
      Effect.map((standing) => standing.type === 'File'),
      Effect.catchReasons('PlatformError', {
        NotFound: () => Effect.succeed(false),
        PermissionDenied: () => Effect.succeed(false),
        BadResource: () => Effect.succeed(false),
        Unknown: (reason, error) =>
          reason.cause instanceof Error && 'code' in reason.cause && reason.cause.code === 'ENAMETOOLONG'
            ? Effect.succeed(false)
            : Effect.fail(error),
      }),
    );
  const { delivery } = road;
  const event = yield* hookEvent(road);
  if (event === undefined) return;
  yield* adoptedHook(road.at, delivery, event, road, false);
  if (ungranted(road)) return;
  const effects = fileEffects(road, event);
  const printed = printedOf(road, event);
  const cwd = eventCwd(road, event);
  const session = sessionKey(road, event);
  if (effects.length === 0 && printed === null) {
    const notices = session === null ? [] : yield* flushPending(road, session, cwd);
    const receipt = yield* report(road, event, 'activity', { call: callOf(road, event) });
    yield* toolSaid(road, event, receipt, notices, 'after');
    return;
  }
  const unsaved: string[] = [];
  for (const file of effects) {
    const basePath = file.effect === 'move' ? file.from : file.path;
    const write = file.effect !== 'read' && session !== null ? writtenTexts(road, session, basePath, file.path) : undefined;
    if (write === undefined || session === null) continue;
    const key = crypto.randomUUID();
    const dir = hookPendingDir(road.temporary, session);
    const op: PendingHookWrite = {
      kind: 'hook-write',
      path: file.path,
      base: basePath,
      before: write.before,
      after: write.after,
      capturedAt: road.capturedAt,
      key,
    };
    if (keepPendingOp(dir, op)) {
      dropBase(road.temporary, session, basePath);
      continue;
    }
    const notice = `record_write was not sent for ${file.path}: its before/after witness could not be saved under ${dir}.`;
    yield* writeNotice(road, key, file.path, notice);
    unsaved.push(notice);
  }
  const said: string[] = [...(session === null ? [] : yield* flushPending(road, session, cwd)), ...unsaved];
  const receipt = yield* report(road, event, 'activity', { call: callOf(road, event) });
  const sighted =
    printed === null
      ? []
      : yield* (
          printed._tag === 'Shell'
            ? shellShown({ command: printed.command, output: printed.output, cwd, root: cwd, home: road.at.env.HOME }, isFile)
            : searchShown({ found: printed.found, output: printed.output, cwd }, isFile)
        ).pipe(
          Effect.match({
            onFailure: (failure) => {
              said.push(`the files this call printed could not be told apart, so no law of their places rides with it: ${failure.message}`);
              return [];
            },
            onSuccess: (shown) => shown,
          }),
        );
  const shown = [...effects.map((file): ToolShown => ({ path: file.path, as: file.effect === 'read' ? 'read' : 'wrote' })), ...sighted];
  const touched = yield* delivery.answered((door) => door.orientation.touch({ query: { cwd }, shown }));
  if (touched !== undefined && touched.briefs.length > 0) {
    const evidence = crypto.randomUUID();
    const guided = yield* delivery.idempotent((door) => door.harness.guide({ payload: { kind: 'touch', evidence, ...touched } }));
    if (guided?.text !== undefined && guided.text !== null) said.push(guided.text);
  }
  yield* toolSaid(road, event, receipt, said, 'after');
});

const permissionRequest = Effect.fnUntraced(function* (road: Road) {
  const { delivery } = road;
  const event = yield* hookEvent(road);
  if (event === undefined) return;
  yield* adoptedHook(road.at, delivery, event, road, false);
  if (ungranted(road)) return;
  const pending = sessionKey(road, event);
  if (pending !== null) yield* flushPending(road, pending, eventCwd(road, event));
  yield* report(road, event, 'self-description');
  const asking = askingOf(road, event);
  if (asking === null) return;
  const judged = yield* delivery.send((door) => door.harness.permission({ payload: asking.call }));
  if (judged._tag !== 'Answered') return;
  const decision = judged.value;
  if (decision._tag === 'Unspoken') return;
  const verdict = verdictOf(decision._tag === 'Asked' ? yield* answerOfQuestion(delivery, decision.requestId) : decision);
  const codec = asking.row.hooks?.codec;
  if (verdict !== null && codec !== undefined) yield* Console.log(codec.permission(verdict));
});

const answerOfQuestion = Effect.fn('hook.permission')(function* (delivery: HookDelivery['Service'], requestId: string) {
  const until = (yield* Clock.currentTimeMillis) + (PERMISSION_TIMEOUT_SECONDS - 1) * 1000;
  while ((yield* Clock.currentTimeMillis) < until) {
    const looked = yield* delivery.hold(
      (door) => door.harness.permissionOutcome({ payload: { requestId } }),
      until - (yield* Clock.currentTimeMillis),
    );
    if (looked._tag === 'Refused') return { _tag: 'Unanswered' } as const;
    if (looked._tag !== 'Answered') {
      const left = until - (yield* Clock.currentTimeMillis);
      if (left <= 0) break;
      yield* Effect.sleep(Math.min(PERMISSION_RETRY_MS, left));
      continue;
    }
    const outcome = looked.value;
    if (outcome._tag === 'Unanswered') return { _tag: 'Unanswered' } as const;
    if (outcome._tag !== 'Waiting') return outcome;
  }
  return { _tag: 'Unanswered' } as const;
});

const stop = Effect.fnUntraced(function* (road: Road) {
  const { delivery } = road;
  const event = yield* hookEvent(road);
  if (event === undefined) return;
  yield* adoptedHook(road.at, delivery, event, road, false);
  if (ungranted(road)) return;
  const pending = sessionKey(road, event);
  if (pending !== null) yield* flushPending(road, pending, eventCwd(road, event));
  yield* report(road, event, 'turn-end', { said: saying(road, event) });
});

const answer = Effect.fnUntraced(function* (road: Road) {
  const event = yield* hookEvent(road);
  if (event === undefined) return;
  yield* adoptedHook(road.at, road.delivery, event, road, false);
  if (ungranted(road)) return;
  yield* report(road, event, 'activity', { said: saying(road, event) });
});

export const hookEventOf = Effect.fnUntraced(function* (
  event: 'session-start' | 'pre-tool-use' | 'post-tool-use' | 'stop' | 'answer' | 'permission-request' | 'observe',
  at: Invocation,
  connect: HookConnect,
  { named, rows }: HookRows,
) {
  const road: Road = {
    at,
    temporary: at.temporary,
    delivery: makeHookDelivery({ connect }),
    capturedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    receipt: `harness-report:${crypto.randomUUID()}`,
    diagnostics: [],
    named,
    rows,
  };
  return yield* event === 'pre-tool-use'
    ? preToolUse(road)
    : event === 'post-tool-use'
      ? postToolUse(road)
      : event === 'stop'
        ? stop(road)
        : event === 'answer'
          ? answer(road)
          : event === 'permission-request'
            ? permissionRequest(road)
            : event === 'observe'
              ? observe(road)
              : sessionStart(road);
});
