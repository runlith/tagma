import * as Effect from 'effect/Effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const scratchDirectory = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );
