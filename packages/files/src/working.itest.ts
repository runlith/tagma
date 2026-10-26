import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { exactWorkingAt, listingUnder, standing } from './working';

const dir = mkdtempSync(join(tmpdir(), 'working-'));
afterAll(() => {
  chmodSync(join(dir, 'Locked'), 0o755);
  rmSync(dir, { recursive: true, force: true });
});

const kindAt = (spelled: string) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.map(exactWorkingAt(listingUnder(dir), spelled, now), (working) => working.kind));

const resolves = (path: string): boolean => {
  try {
    lstatSync(join(dir, path));
    return true;
  } catch {
    return false;
  }
};

mkdirSync(join(dir, 'Shared'));
writeFileSync(join(dir, 'Shared', 'Theme.ts'), 'x');
symlinkSync('Theme.ts', join(dir, 'Shared', 'Link.ts'));
symlinkSync('Shared', join(dir, 'shared-link'));
const decomposed = 'Jo\u0308.ts';
const composed = 'J\u00f6.ts';
writeFileSync(join(dir, decomposed), 'x');
mkdirSync(join(dir, 'Locked'));
writeFileSync(join(dir, 'Locked', 'inside.ts'), 'x');

it.live('a path spelled in another case than its entries on disk is absent, symlinks spelled as named', () =>
  Effect.gen(function* () {
    expect(yield* kindAt('Shared/Theme.ts')).toBe('file');
    expect(yield* kindAt('Shared/theme.ts')).toBe('absent');
    expect(yield* kindAt('shared/Theme.ts')).toBe('absent');
    expect(yield* kindAt('Shared/Link.ts')).toBe('link');
    expect(yield* kindAt('Shared/link.ts')).toBe('absent');
    expect(yield* kindAt('shared-link/Theme.ts')).toBe('file');
    expect(yield* kindAt('shared-link/theme.ts')).toBe('absent');
  }),
);

it.live('another Unicode normalization of an entry stands exactly where the filesystem itself finds it', () =>
  Effect.gen(function* () {
    const listing = listingUnder(dir);
    expect(yield* standing(decomposed, listing)).toBe('stands');
    expect(yield* standing(composed, listing)).toBe(resolves(composed) ? 'stands' : 'absent');
    expect(yield* kindAt(composed)).toBe(resolves(composed) ? 'file' : 'absent');
    expect(yield* standing('Shared/theme.ts', listing)).toBe('absent');
  }),
);

it.live('a directory that can be entered but not listed answers unread with its reason, never absent or present', () =>
  Effect.gen(function* () {
    chmodSync(join(dir, 'Locked'), 0o111);
    const stood = yield* standing('Locked/inside.ts', listingUnder(dir));
    const kind = yield* kindAt('Locked/inside.ts');
    chmodSync(join(dir, 'Locked'), 0o755);
    if (process.getuid?.() === 0) return;
    expect(stood).toMatchObject({ unread: expect.stringContaining('EACCES') });
    expect(kind).toBe('unread');
  }),
);
