import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { openUsage } from './composition/testing/native';

import { HOLDER_LIBRARY as libraryPath } from './posix/testing/holder';
const workload = 'printf "READY\\n"; read next; /usr/bin/awk \'BEGIN { for (i=0;i<10000;i++) sum+=i }\'; printf "REAPED\\n"; read done';
const printed = (source: ReadableStream<Uint8Array>, marker: string) =>
  Effect.promise(async () => {
    const reader = source.getReader();
    const decoder = new TextDecoder();
    let output = '';
    try {
      while (!output.includes(marker)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`the workload ended before ${marker}: ${output}`);
        output += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  });

it.live('the kernel usage adapter includes CPU of children reaped between readings', () =>
  Effect.gen(function* () {
    const child = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.spawn(['/bin/sh', '-c', workload], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })),
      (child) =>
        Effect.andThen(
          Effect.sync(() => child.stdin.end()),
          Effect.promise(() => child.exited),
        ),
    );
    yield* printed(child.stdout, 'READY\n');
    const usage = yield* openUsage(libraryPath);
    const before = yield* usage.read({ others: false });
    yield* Effect.sync(() => child.stdin.write('run\n'));
    yield* printed(child.stdout, 'REAPED\n');
    const after = yield* usage.read({ others: false });
    const first = before.processes.find((row) => row.pid === child.pid)?.cpu;
    const last = after.processes.find((row) => row.pid === child.pid)?.cpu;
    expect(first).toBeDefined();
    expect(last?.reapedMicros).toBeGreaterThan(first?.reapedMicros ?? 0);
    expect(after.takenAtMicros).toBeGreaterThan(before.takenAtMicros);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
