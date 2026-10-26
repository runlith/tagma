import { Data, Effect } from 'effect';

export class SpawnRefused extends Data.TaggedError('SpawnRefused')<{ readonly command: readonly string[]; readonly cause: unknown }> {}

export type Spawning = {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly stdin?: 'ignore' | 'inherit' | Uint8Array | Blob;
  readonly stdout?: 'pipe' | 'ignore' | 'inherit';
  readonly stderr?: 'pipe' | 'ignore' | 'inherit';
};

export type Spawned = {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | number | null;
  readonly success: boolean;
  readonly pid: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
};

const drained = async (stream: ReadableStream<Uint8Array> | number | undefined): Promise<Buffer> =>
  stream instanceof ReadableStream ? Buffer.from(await new Response(stream).arrayBuffer()) : Buffer.alloc(0);

export const spawnedEffect = (command: readonly string[], options: Spawning = {}): Effect.Effect<Spawned, SpawnRefused> =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => Bun.spawn([...command], { stdout: 'pipe', stderr: 'pipe', ...options }),
      catch: (cause) => new SpawnRefused({ command, cause }),
    }),
    (child) =>
      Effect.promise(async () => {
        const [stdout, stderr, exitCode] = await Promise.all([drained(child.stdout), drained(child.stderr), child.exited]);
        return {
          exitCode: child.signalCode === null ? exitCode : null,
          signalCode: child.signalCode,
          success: child.signalCode === null && exitCode === 0,
          pid: child.pid,
          stdout,
          stderr,
        };
      }),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await child.exited;
      }),
  );
