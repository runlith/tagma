import { join } from 'node:path';
import { degraded } from '@runlith/activity/Activity';
import { Effect, FileSystem, Queue, Schema } from 'effect';
import { PluginHost } from '../../plugin-host/contract/service/supervision.js';
import { ViewPlaces, WindowStyles } from '../contract/service/places.js';
import { sheetAddress } from '../contract/wire/modules.js';
import { WindowUtilities } from '../contract/wire/utilities.js';
import { hashed } from './compile.js';
import type { Compiler } from './compiler.js';

type SheetSource = { readonly preparing: boolean; readonly candidates: readonly string[] };

const SHEETS = 'sheet';

const decodeUtilities = Schema.decodeUnknownEffect(Schema.fromJsonString(WindowUtilities));

export const makeSheet = Effect.fnUntraced(function* (input: {
  readonly compiler: Compiler;
  readonly standing: () => readonly SheetSource[];
  readonly changed: () => void;
}) {
  const { compiler, standing, changed } = input;
  const { home } = yield* ViewPlaces;
  const styles = yield* WindowStyles;
  const host = yield* PluginHost;
  const files = yield* FileSystem.FileSystem;
  const asked = yield* Queue.sliding<void>(1);
  const place = join(home, SHEETS);
  let address: string | null = null;

  const windowStyles = yield* Effect.cached(
    Effect.gen(function* () {
      if (styles.utilities === null || !(yield* files.exists(styles.utilities))) return null;
      const text = yield* files.readFileString(styles.utilities);
      return { hash: hashed(text), utilities: yield* decodeUtilities(text) };
    }),
  );

  const shown = (next: string | null): void => {
    if (address === next) return;
    address = next;
    changed();
  };

  const swept = Effect.fnUntraced(function* (kept: string | null) {
    if (!(yield* files.exists(place))) return;
    const stale = (yield* files.readDirectory(place)).filter((name) => name !== kept);
    yield* Effect.forEach(stale, (name) => files.remove(join(place, name), { recursive: true, force: true }), { discard: true });
  });

  const made = Effect.fn('PluginViews.sheet')(function* () {
    const sources = standing();
    if (sources.some((one) => one.preparing)) return;
    const window = yield* windowStyles;
    const own = new Set(window?.utilities.candidates ?? []);
    const added = [...new Set(sources.flatMap((one) => one.candidates))].filter((candidate) => !own.has(candidate)).sort();
    if (window === null || added.length === 0) {
      shown(null);
      return yield* swept(null);
    }
    const file = `${hashed(`${window.hash}\u0000${added.join('\n')}`)}.css`;
    const out = join(place, file);
    if (!(yield* files.exists(out)))
      yield* compiler.compiled((id) => ({ id, kind: 'sheet', utilities: window.utilities, candidates: added, out }));
    shown(sheetAddress(file));
    yield* swept(file);
  });

  yield* Effect.forkScoped(
    host.started.pipe(
      Effect.andThen(
        Effect.forever(
          Queue.take(asked).pipe(
            Effect.andThen(
              degraded(
                'views sheet',
                'the window keeps the previous utilities sheet, so plugin classes it lacks stay unstyled until the published views change again',
                Effect.orDie(made()),
                () => undefined,
              ),
            ),
          ),
        ),
      ),
    ),
  );

  return {
    address: (): string | null => address,
    refresh: (): void => {
      Queue.offerUnsafe(asked, undefined);
    },
    file: (name: string): string => join(place, name),
  };
});
