import { randomUUID } from 'node:crypto';
import { Effect, type Scope } from 'effect';

const BUNDLE_RUNTIME = 'bun';
const RECOVERY_ENTRY = 'recovery/recovery.js';

const COMPLETE = 'ShutdownComplete';

const QUOTED = 400;

export type RecoveryInput = {
  readonly bundle: string;
  readonly state: string;
};

export type RecoveryEnding = { readonly _tag: 'Ended'; readonly detail: string } | { readonly _tag: 'Refused'; readonly detail: string };

const said = (text: string): string => {
  const first = text.trim().split('\n')[0]?.trim() ?? '';
  return first.length > QUOTED ? `${first.slice(0, QUOTED)}…` : first;
};

const refused = (detail: string): RecoveryEnding => ({ _tag: 'Refused', detail });

const answerOf = (stdout: string, stderr: string): string => (said(stdout) === '' ? said(stderr) : said(stdout));

const QUOTED_REST = QUOTED * 4;

const beside = (stdout: string, stderr: string): string => {
  const verdict = answerOf(stdout, stderr);
  const rest = `${stdout}\n${stderr}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== verdict)
    .join(' ');
  if (rest === '') return '';
  return ` — it also said: ${rest.length > QUOTED_REST ? `${rest.slice(0, QUOTED_REST)}…` : rest}`;
};

export const endByRecovery = Effect.fnUntraced(function* (input: RecoveryInput) {
  const ending = yield* Effect.scoped(running(input));
  yield* ending._tag === 'Ended' ? Effect.log(ending.detail) : Effect.logWarning(ending.detail);
  return ending;
});

type ProgramAnswer =
  | { readonly _tag: 'Answered'; readonly stdout: string; readonly stderr: string; readonly code: number }
  | { readonly _tag: 'Unstarted'; readonly detail: string }
  | { readonly _tag: 'Signalled'; readonly detail: string };

const runProgram = Effect.fnUntraced(function* (
  input: RecoveryInput,
  args: ReadonlyArray<string>,
): Effect.fn.Return<ProgramAnswer, never, Scope.Scope> {
  const program = `${input.bundle}/${RECOVERY_ENTRY}`;
  const started = yield* Effect.result(
    Effect.acquireRelease(
      Effect.try({
        try: () =>
          Bun.spawn([`${input.bundle}/${BUNDLE_RUNTIME}`, program, input.state, ...args], {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            cwd: input.state,
          }),
        catch: (error) => String(error),
      }),
      (child) =>
        Effect.try(() => child.kill('SIGKILL')).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('the host recovery program could not be killed after its scope ended', { program, failure }),
          ),
          Effect.asVoid,
        ),
    ),
  );
  if (started._tag === 'Failure') {
    return {
      _tag: 'Unstarted',
      detail: `the recovery program at ${program} would not run: ${said(started.failure)}`,
    } as const;
  }
  const child = started.success;
  const [stdout, stderr, code] = yield* Effect.promise(() =>
    Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]),
  );
  if (child.signalCode !== null) {
    return { _tag: 'Signalled', detail: `the recovery program at ${program} was ended by ${child.signalCode} before it answered` } as const;
  }
  return { _tag: 'Answered', stdout, stderr, code } as const;
});

const running = Effect.fnUntraced(function* (input: RecoveryInput): Effect.fn.Return<RecoveryEnding, never, Scope.Scope> {
  const key = `host-recover-${randomUUID()}`;
  const printed = yield* runProgram(input, ['shutdown', key]);
  if (printed._tag === 'Unstarted') return refused(printed.detail);
  if (printed._tag === 'Signalled') {
    return refused(`${printed.detail}; the shutdown may have run: read it back: ${operationCommand(input, key)}`);
  }
  const answer = answerOf(printed.stdout, printed.stderr);
  if (printed.code === 0 && answer === COMPLETE) {
    return { _tag: 'Ended', detail: `the recovery program of ${input.bundle} answered ${COMPLETE}` };
  }
  const incomplete = incompleteOf(printed.stdout);
  return refused(
    `the recovery program of ${input.bundle} answered ${answer} (exit ${printed.code})` +
      `${incomplete === '' ? beside(printed.stdout, printed.stderr) : incomplete}`,
  );
});

const incompleteOf = (stdout: string): string => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines[0] !== 'ShutdownIncomplete') return '';
  const reason = lines.find((line) => line.startsWith('incomplete:')) ?? '';
  const residual = lines.filter((line) => line.startsWith('residual ')).length;
  const unverifiable = lines.filter((line) => line.startsWith('unverifiable ')).length;
  const quoted = reason === '' ? 'no reason given' : reason.length > QUOTED ? `${reason.slice(0, QUOTED)}…` : reason;
  return ` — ${quoted}; residual ${residual} unverifiable ${unverifiable}`;
};

export type RecoveryMeasure =
  | { readonly _tag: 'Measured'; readonly live: number; readonly command: string }
  | { readonly _tag: 'Unmeasured'; readonly detail: string; readonly command: string };

export const shutdownCommand = (input: RecoveryInput, key = `host-recover-${randomUUID()}`): string =>
  `${input.bundle}/${BUNDLE_RUNTIME} ${input.bundle}/${RECOVERY_ENTRY} ${input.state} shutdown ${key}`;

export const operationCommand = (input: RecoveryInput, key: string): string =>
  `${input.bundle}/${BUNDLE_RUNTIME} ${input.bundle}/${RECOVERY_ENTRY} ${input.state} operation ${key}`;

export type RecoveryVersion =
  | { readonly _tag: 'Known'; readonly wire: number; readonly digest: string | undefined; readonly build: string | undefined }
  | { readonly _tag: 'Unknown'; readonly detail: string };

const readVersion = (text: string): { wire: number; digest: string | undefined; build: string | undefined } | undefined => {
  const tokens = said(text).split(/\s+/);
  if (tokens[0] !== 'wire' || tokens[2] !== 'bundle') return undefined;
  const wire = Number(tokens[1]);
  if (!Number.isSafeInteger(wire) || wire <= 0) return undefined;
  if (tokens[3] === undefined || tokens[3] === 'unknown') return { wire, digest: undefined, build: undefined };
  const build = tokens[4] === 'build' ? tokens.slice(5).join(' ') : undefined;
  return { wire, digest: tokens[3], build: build === '' ? undefined : build };
};

export const readRecoveryVersion = Effect.fnUntraced(function* (input: RecoveryInput): Effect.fn.Return<RecoveryVersion> {
  const printed = yield* Effect.scoped(runProgram(input, ['version']));
  if (printed._tag !== 'Answered') return { _tag: 'Unknown', detail: printed.detail } as const;
  if (printed.code !== 0) {
    return {
      _tag: 'Unknown',
      detail: `the recovery program of ${input.bundle} answered ${answerOf(printed.stdout, printed.stderr)} (exit ${printed.code})`,
    } as const;
  }
  const version = readVersion(printed.stdout);
  if (version === undefined) {
    return {
      _tag: 'Unknown',
      detail: `the version answer did not parse: ${answerOf(printed.stdout, printed.stderr)}`,
    } as const;
  }
  return { _tag: 'Known', ...version } as const;
});

const LIVE = new Set(['reserved', 'queued', 'starting', 'running', 'stopping']);

const MAX_PAGES = 64;

const readRow = (tokens: ReadonlyArray<string>): boolean | undefined => {
  if (tokens.length !== 8 || tokens[4] !== 'cleanup' || tokens[6] !== 'record') return undefined;
  const phase = tokens[2] ?? '';
  if (phase === 'ended') return false;
  return LIVE.has(phase) ? true : undefined;
};

const readCursor = (tokens: ReadonlyArray<string>): { execution: string; incarnation: number } | undefined => {
  if (tokens.length !== 4 || tokens[0] !== 'more' || tokens[1] !== 'after') return undefined;
  const execution = tokens[2] ?? '';
  const incarnation = Number(tokens[3]);
  if (execution === '' || !Number.isSafeInteger(incarnation) || incarnation < 0) return undefined;
  return { execution, incarnation };
};

const readPage = (text: string): { live: number; more: { execution: string; incarnation: number } | undefined } | undefined => {
  let live = 0;
  let more: { execution: string; incarnation: number } | undefined;
  let continuations = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens[0] === 'more') {
      const cursor = readCursor(tokens);
      if (cursor === undefined) return undefined;
      continuations += 1;
      more = cursor;
      continue;
    }
    const standing = readRow(tokens);
    if (standing === undefined) return undefined;
    if (standing) live += 1;
  }
  return continuations > 1 ? undefined : { live, more };
};

export const listByRecovery = Effect.fnUntraced(function* (input: RecoveryInput): Effect.fn.Return<RecoveryMeasure> {
  const command = shutdownCommand(input);
  let live = 0;
  let after: { execution: string; incarnation: number } | undefined;
  const unmeasured = (detail: string): RecoveryMeasure =>
    ({
      _tag: 'Unmeasured',
      detail: live === 0 ? detail : `${detail}; ${live} live counted before the listing failed`,
      command,
    }) as const;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const args = after === undefined ? ['list'] : ['list', after.execution, String(after.incarnation)];
    const printed = yield* Effect.scoped(runProgram(input, args));
    if (printed._tag !== 'Answered') return unmeasured(printed.detail);
    if (printed.code !== 0) {
      const answer = answerOf(printed.stdout, printed.stderr);
      return unmeasured(`the recovery program of ${input.bundle} answered ${answer} (exit ${printed.code})`);
    }
    const read = readPage(printed.stdout);
    if (read === undefined) {
      return unmeasured(`the list answer did not parse: ${answerOf(printed.stdout, printed.stderr)}`);
    }
    live += read.live;
    after = read.more;
    if (after === undefined) return { _tag: 'Measured', live, command } as const;
  }
  return unmeasured(`the inventory did not end within ${MAX_PAGES} pages`);
});
