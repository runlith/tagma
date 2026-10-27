import { tempRepo } from '@runlith/git/testing';
import { unthreadedCaller } from './caller';
import type { WorkspaceChange } from '@runlith/files/change';
import { landedOf } from '../WorkspaceChanges';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool, ToolPreparation, ToolRefusal, ToolShown } from '@runlith/agent/tool';
import { ToolAnswer, ToolFailed, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { type ToolDisplay } from '@runlith/agent/tool/display';
import { Effect } from 'effect';
import type { CommandLife, CommandMove, CommandVerdict, WorkspaceChanges } from '../WorkspaceChanges';
import { machineWorld } from '../world/machine';
import type { World } from '../world';
import { unruledTimes } from '../CommandWork';
import type { ToolFactoryOptions } from '../workspace';

export const options = <W extends World = typeof machineWorld>(
  overrides: Omit<Partial<ToolFactoryOptions>, 'world'> & { cwd: string; world?: W },
): ToolFactoryOptions & { world: W } => {
  const { world, ...rest } = overrides;
  return { commandTimes: unruledTimes, searchMs: 25_000, ...rest, world: (world ?? machineWorld) as W };
};

function readFileFx(path: string): Effect.Effect<Buffer>;
function readFileFx(path: string, encoding: 'utf8'): Effect.Effect<string>;
function readFileFx(path: string, encoding?: 'utf8'): Effect.Effect<Buffer> | Effect.Effect<string> {
  return encoding === undefined ? Effect.promise(() => readFile(path)) : Effect.promise(() => readFile(path, encoding));
}

export const host = {
  chmod: (...args: Parameters<typeof chmod>) => Effect.promise(() => chmod(...args)),
  lstat: (path: string) => Effect.promise(() => lstat(path)),
  mkdir: (...args: Parameters<typeof mkdir>) => Effect.promise(() => mkdir(...args)),
  readdir: (path: string) => Effect.promise(() => readdir(path)),
  readFile: readFileFx,
  realpath: (path: string) => Effect.promise(() => realpath(path)),
  rename: (...args: Parameters<typeof rename>) => Effect.promise(() => rename(...args)),
  rm: (...args: Parameters<typeof rm>) => Effect.promise(() => rm(...args)),
  stat: (path: string) => Effect.promise(() => stat(path)),
  symlink: (...args: Parameters<typeof symlink>) => Effect.promise(() => symlink(...args)),
  truncate: (...args: Parameters<typeof truncate>) => Effect.promise(() => truncate(...args)),
  utimes: (...args: Parameters<typeof utimes>) => Effect.promise(() => utimes(...args)),
  writeFile: (...args: Parameters<typeof writeFile>) => Effect.promise(() => writeFile(...args)),
};

export const preparationOf = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const prepare = toolPrepare(tool);
  if (!prepare) return null;
  return (yield* prepare(input, { toolCallId: 'call-1', caller: unthreadedCaller })) as ToolPreparation<unknown>;
});

export const prepared = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const preparation = yield* preparationOf(tool, input);
  return preparation === null ? {} : ({ prepared: preparation.prepared } as Partial<Tool.ToolCallOptions>);
});

export type Answered = {
  value: unknown;
  display: ToolDisplay | undefined;
  shown: readonly ToolShown[];
  refusal: ToolRefusal | undefined;
};

export const answer = Effect.fnUntraced(function* (
  tool: Tool,
  input: unknown,
  options: Partial<Tool.ToolCallOptions> = {},
  afterPrepared: () => void = () => {},
) {
  const execute = toolExecute(tool);
  if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
  const prepare = toolPrepare(tool);
  const preparation = prepare === null ? null : yield* Effect.result(prepare(input, { toolCallId: 'call-1', caller: unthreadedCaller }));
  if (preparation?._tag === 'Failure') {
    const failure = preparation.failure;
    return { value: failure.message, display: undefined, shown: [], refusal: failure.refusal ?? undefined } satisfies Answered;
  }
  afterPrepared();
  const resolution = preparation === null ? {} : ({ prepared: preparation.success.prepared } as Partial<Tool.ToolCallOptions>);
  const settled = yield* (
    execute(input, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [], ...resolution, ...options }) as Effect.Effect<
      unknown,
      ToolFailed
    >
  ).pipe(Effect.catch((failure) => Effect.succeed(failure)));
  if (settled instanceof ToolFailed) {
    return { value: settled.message, display: undefined, shown: [], refusal: settled.refusal ?? undefined } satisfies Answered;
  }
  return (
    settled instanceof ToolAnswer
      ? {
          value: settled.value,
          display: settled.display,
          shown: settled.shown,
          refusal: settled.verdict.kind === 'refused' ? settled.verdict.refusal : undefined,
        }
      : { value: settled, display: undefined, shown: [], refusal: undefined }
  ) satisfies Answered;
});

export const call = Effect.fnUntraced(function* (
  tool: Tool,
  input: unknown,
  options: Partial<Tool.ToolCallOptions> = {},
  afterPrepared?: () => void,
) {
  const { value } = yield* answer(tool, input, options, afterPrepared);
  return typeof value === 'string' ? value : JSON.stringify(value);
});

export const exists = (path: string) =>
  Effect.promise(() =>
    stat(path).then(
      () => true,
      () => false,
    ),
  );

export const createTempDir = () =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'runlith-tools-'))),
    (dir) => Effect.promise(() => rm(dir, { force: true, recursive: true })),
  );

export function recorder() {
  const changes: WorkspaceChange[] = [];
  const moves: CommandMove[] = [];
  return {
    changes,
    moves,
    port: {
      land: <E, R>(batch: readonly WorkspaceChange[], write: Effect.Effect<boolean, E, R>) =>
        Effect.map(write, (written) => {
          if (written) changes.push(...batch);
          return landedOf(written, written);
        }),
      landEach: <E, R>(batch: readonly WorkspaceChange[], write: Effect.Effect<readonly boolean[], E, R>) =>
        Effect.map(write, (written) =>
          batch.map((change, at) => {
            const landed = written[at] === true;
            if (landed) changes.push(change);
            return landedOf(landed, landed);
          }),
        ),
      command: () =>
        Effect.succeed<CommandLife>({
          based: () => Effect.void,
          opened: () => {},
          ended: () => {},
          close: () => {},
          forget: () => {},
          settle: (moved) =>
            Effect.sync(() => {
              moves.push(...moved.moves);
              return moved.moves.map((move): CommandVerdict => ({ name: move.name, verdict: 'attributed' }));
            }),
        }),
    } satisfies WorkspaceChanges,
  };
}

export const checkout = Effect.fnUntraced(function* (committed: Record<string, string> = {}) {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => tempRepo('runlith-tools-', 'unborn')),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  );
  yield* Effect.promise(async () => {
    for (const [name, text] of Object.entries(committed)) {
      await mkdir(join(dir, name, '..'), { recursive: true });
      await writeFile(join(dir, name), text);
    }
    if (Object.keys(committed).length > 0) {
      await Bun.$`git add -A`.cwd(dir).quiet();
      await Bun.$`git commit -qm first`.cwd(dir).quiet();
    }
  });
  return dir;
});
