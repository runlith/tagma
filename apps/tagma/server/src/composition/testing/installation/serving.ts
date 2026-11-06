import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schedule } from 'effect';

type Ports = readonly [number, number, number, number];

export const freePorts = (): Ports => {
  const listeners = Array.from({ length: 4 }, () => Bun.serve({ port: 0, fetch: () => new Response('') }));
  const ports = listeners.map((listener) => listener.port!);
  for (const listener of listeners) listener.stop(true);
  return ports as unknown as Ports;
};

const INHERITED = new Set(['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL']);

export const worldEnv = (root: string, data: string, ports: Ports): Record<string, string | undefined> => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => INHERITED.has(key) || key.startsWith('RUNLITH_'))),
  HOME: join(root, 'home'),
  TAGMA_DATABASE_PATH: join(data, 'tagma.sqlite'),
  TAGMA_SEED_DIRECTORY: join(root, 'seeds'),
  TAGMA_INSTALL_ROOT: join(root, 'install'),
  TAGMA_PORT: String(ports[0]),
  TAGMA_ARTIFACT_PORT: String(ports[1]),
  TAGMA_SANDBOX_PORT: String(ports[2]),
  TAGMA_REMOTE_PORT: String(ports[3]),
  TAGMA_SQLITE_READERS: '1',
});

export const served = (release: string, env: Record<string, string | undefined>, log: string) => {
  const sink = openSync(log, 'a');
  const child = Bun.spawn([join(release, 'bun'), '--no-install', join(release, 'bin/cli/main.js'), 'serve'], {
    env,
    stdin: 'ignore',
    stdout: sink,
    stderr: sink,
    detached: true,
  });
  closeSync(sink);
  return child;
};

type Health = { readonly source: { readonly installation: { readonly build: string } | null } };

export const healthAt = (origin: string): Effect.Effect<Health | null> =>
  Effect.promise(() =>
    fetch(`${origin}/health`)
      .then((answer) => (answer.status === 200 ? (answer.json() as Promise<Health>) : null))
      .catch(() => null),
  );

export const servingBuild = (origin: string, build: string) =>
  Effect.repeat(healthAt(origin), {
    until: (health) => health?.source.installation?.build === build,
    schedule: Schedule.spaced('100 millis'),
  });

export const op = (origin: string, id: string, input: object) =>
  Effect.promise(async () => {
    const answer = await fetch(`${origin}/api/op/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return { status: answer.status, body: (await answer.json()) as Record<string, unknown> };
  });
