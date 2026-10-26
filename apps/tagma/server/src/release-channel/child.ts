import { Effect } from 'effect';

const GRACE_MS = 2_000;

export type Captured = { readonly code: number; readonly out: string; readonly err: string };

const owned = <A>(child: Bun.Subprocess, ended: Promise<A>): Effect.Effect<A> =>
  Effect.callback<A>((resume) => {
    void ended.then((value) => resume(Effect.succeed(value)));
    return Effect.promise(async () => {
      child.kill('SIGTERM');
      const gone = await Promise.race([child.exited.then(() => true), Bun.sleep(GRACE_MS).then(() => false)]);
      if (gone) return;
      child.kill('SIGKILL');
      await child.exited;
    });
  });

export const captured = (command: readonly string[], env: NodeJS.ProcessEnv): Effect.Effect<Captured> =>
  Effect.suspend(() => {
    const child = Bun.spawn([...command], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const ended = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).then(
      ([code, out, err]) => ({ code, out, err }),
    );
    return owned(child, ended);
  });

export const logged = (command: readonly string[], env: NodeJS.ProcessEnv, sink: number): Effect.Effect<number> =>
  Effect.suspend(() => {
    const child = Bun.spawn([...command], { env, stdin: 'ignore', stdout: sink, stderr: sink });
    return owned(child, child.exited);
  });
