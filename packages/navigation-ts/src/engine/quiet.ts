import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { API } from 'typescript7/async';

const QUIET = 30_000;

export type Quiet = {
  readonly still: () => void;
  readonly calm: () => void;
  readonly close: () => Promise<void>;
};

export const makeQuiet = (api: API, root: string, working: () => boolean): Quiet => {
  let hush: ReturnType<typeof setTimeout> | null = null;
  let profiles: string | null = null;
  let closed = false;

  const still = () => {
    if (hush === null) return;
    clearTimeout(hush);
    hush = null;
  };

  const collect = async () => {
    hush = null;
    if (closed || working()) return;
    profiles ??= mkdtempSync(join(tmpdir(), 'navigation-'));
    await rm(await api.debug.saveHeapProfile(profiles), { force: true });
    Bun.gc(true);
  };

  return {
    still,
    calm: () => {
      still();
      if (closed || working()) return;
      hush = setTimeout(
        () =>
          void collect().catch((cause: unknown) =>
            console.error(`${root} could not return its garbage: ${cause instanceof Error ? cause.message : String(cause)}`),
          ),
        QUIET,
      );
    },
    close: async () => {
      closed = true;
      still();
      if (profiles !== null) await rm(profiles, { recursive: true, force: true });
    },
  };
};
