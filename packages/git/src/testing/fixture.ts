import { constants, cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Git, gitLayer } from '../Git.js';

const host = gitLayer.pipe(
  Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))),
);

const open = () => ManagedRuntime.make(host);
let runtime: ReturnType<typeof open> | undefined;

export const onGit = <A, E>(work: (git: Git['Service']) => Effect.Effect<A, E>): Promise<A> =>
  (runtime ??= open()).runPromise(Effect.flatMap(Git, work));

export type InitialHead = 'born' | 'unborn';

const roots: string[] = [];
const templates = new Map<InitialHead, Promise<string>>();

export function tempRoot(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  roots.push(made);
  return realpathSync(made);
}

export async function release(): Promise<void> {
  const held = runtime;
  runtime = undefined;
  templates.clear();
  try {
    if (held !== undefined) await held.dispose();
  } finally {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  }
}

async function run(cwd: string, args: readonly string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const ran = await run(cwd, args);
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

export async function gitExit(cwd: string, args: readonly string[]): Promise<number> {
  return (await run(cwd, args)).exitCode;
}

async function emptyRepo(initial: InitialHead): Promise<string> {
  const root = tempRoot('git-template-');
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'git@test']);
  await git(root, ['config', 'user.name', 'git']);
  if (initial === 'born') await git(root, ['commit', '-q', '--allow-empty', '-m', 'born']);
  return root;
}

export async function tempRepo(prefix: string, initial: InitialHead = 'born'): Promise<string> {
  const ready = templates.get(initial) ?? emptyRepo(initial);
  templates.set(initial, ready);
  const source = await ready;
  const root = tempRoot(prefix);
  cpSync(join(source, '.git'), join(root, '.git'), { recursive: true, mode: constants.COPYFILE_FICLONE });
  return root;
}
