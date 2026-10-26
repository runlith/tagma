import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import { CheckoutBaselines } from './CheckoutBaselines';
import { CheckoutFlights } from './CheckoutFlights';
import { machineWorld } from './world/machine';
import { options } from './testing/toolHarness';
import { resolveToolOptions } from './workspace/runtime';

const root = await mkdtemp(join(tmpdir(), 'checkout-bench-'));
let hashedBytes = 0;
const files = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fs) => ({
    ...fs,
    stream: (path: string, options?: Parameters<typeof fs.stream>[1]) =>
      fs.stream(path, options).pipe(
        Stream.tap((bytes) =>
          Effect.sync(() => {
            hashedBytes += bytes.length;
          }),
        ),
      ),
  })),
).pipe(Layer.provide(machineWorld.files));
const services = Layer.mergeAll(files, machineWorld.exec, machineWorld.git);
const resolved = resolveToolOptions(options({ cwd: root, world: { ...machineWorld, files } }));
const baselines = new CheckoutBaselines(new CheckoutFlights());
const git = async (...args: string[]) => {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(stderr);
  return stdout;
};
const samples = async (label: string) => {
  const times: number[] = [];
  const bytes: number[] = [];
  for (let i = 0; i < 6; i++) {
    hashedBytes = 0;
    const start = performance.now();
    const reading = await Effect.runPromise(baselines.measure(root, resolved).pipe(Effect.provide(services)));
    if ('unreadable' in reading) throw new Error(reading.unreadable);
    times.push(performance.now() - start);
    bytes.push(hashedBytes);
  }
  console.log(
    JSON.stringify({
      label,
      milliseconds: times,
      hashedBytes: bytes,
      dirtyFiles: label === 'clean' ? 0 : 24,
      dirtyMiB: label === 'clean' ? 0 : 96,
    }),
  );
};
const metadata = async (cwd: string, label: string) => {
  for (const args of [
    ['--no-optional-locks', 'status', '--porcelain', '-z', '-unormal'],
    ['rev-parse', '--verify', 'HEAD'],
  ]) {
    const times: number[] = [];
    let outputBytes = 0;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
      const [code, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).text(),
      ]);
      if (code !== 0) throw new Error(error);
      times.push(performance.now() - start);
      outputBytes = output.byteLength;
    }
    console.log(JSON.stringify({ label, git: args.join(' '), milliseconds: times, outputBytes }));
  }
};
try {
  await git('init', '-q');
  await git('-c', 'user.email=test@example.test', '-c', 'user.name=bench', 'commit', '--allow-empty', '-qm', 'baseline');
  await samples('clean');
  await metadata(root, 'clean-fixture');
  const bytes = Buffer.alloc(4 * 1024 * 1024, 97);
  for (let i = 0; i < 24; i++) await writeFile(join(root, `dirty-${i}`), bytes);
  await Bun.sleep(2100);
  await samples('settled-dirty');
  await metadata(root, 'dirty-fixture');
  if (process.argv[2] !== undefined) await metadata(process.argv[2], 'repository');
} finally {
  await rm(root, { recursive: true, force: true });
}
