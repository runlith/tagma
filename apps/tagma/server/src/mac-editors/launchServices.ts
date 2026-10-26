import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { EditorHost, type Launcher, LookupFailed, type Sighting } from '../editors/contract/service/host.js';
import type { EditorEntry } from '../editors/contract/wire/catalog.js';

const OSASCRIPT = '/usr/bin/osascript';
const OPEN = '/usr/bin/open';
const ICON_PIXELS = 32;

const SCRIPT = `ObjC.import('AppKit');
function icon(ws, path) {
  try {
    const image = ws.iconForFile(path);
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, ${ICON_PIXELS}, ${ICON_PIXELS}, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
    $.NSGraphicsContext.saveGraphicsState;
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
    image.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, ${ICON_PIXELS}, ${ICON_PIXELS}), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
    $.NSGraphicsContext.restoreGraphicsState;
    return rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({})).base64EncodedStringWithOptions(0).js;
  } catch (e) {
    return null;
  }
}
function run(argv) {
  const ask = JSON.parse(argv[0]);
  const ws = $.NSWorkspace.sharedWorkspace;
  const out = {};
  for (const id of ask.ids) {
    try {
      const url = ws.URLForApplicationWithBundleIdentifier(id);
      if (url.isNil()) { out[id] = null; continue; }
      const path = url.path.js;
      out[id] = { path: path, icon: ask.known.indexOf(path) === -1 ? icon(ws, path) : null };
    } catch (e) {
      out[id] = { failed: String(e) };
    }
  }
  return JSON.stringify(out);
}`;

const Answer = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.NullOr(
      Schema.Union([Schema.Struct({ path: Schema.String, icon: Schema.NullOr(Schema.String) }), Schema.Struct({ failed: Schema.String })]),
    ),
  ),
);

export const makeMacEditors = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const files = yield* FileSystem.FileSystem;
  const icons = new Map<string, string | null>();

  const ask = Effect.fn('EditorHost.launchServices')(
    function* (ids: readonly string[]) {
      const known = [...icons.keys()];
      const output = yield* spawner.string(
        ChildProcess.make(OSASCRIPT, ['-l', 'JavaScript', '-e', SCRIPT, JSON.stringify({ ids, known })], { stdin: 'ignore' }),
      );
      return yield* Schema.decodeUnknownEffect(Answer)(output.trim());
    },
    (effect) =>
      Effect.mapError(effect, (failure) => new LookupFailed({ message: `LaunchServices could not be asked: ${failure.message}` })),
  );

  const launcherOf = Effect.fnUntraced(function* (entry: EditorEntry, app: string) {
    if (entry.mac?.cli === undefined) return { program: OPEN, prefix: ['-na', app, '--args'] } satisfies Launcher;
    for (const cli of entry.mac.cli) {
      const program = join(app, cli);
      if (yield* files.exists(program)) return { program, prefix: [] } satisfies Launcher;
    }
    return null;
  });

  const sightingOf = Effect.fnUntraced(
    function* (entry: EditorEntry, answer: typeof Answer.Type) {
      const failures: string[] = [];
      for (const id of entry.mac?.ids ?? []) {
        const seen = answer[id];
        if (seen === null || seen === undefined) continue;
        if ('failed' in seen) {
          failures.push(seen.failed);
          continue;
        }
        if (seen.icon !== null || !icons.has(seen.path))
          icons.set(seen.path, seen.icon === null ? null : `data:image/png;base64,${seen.icon}`);
        const launcher = yield* launcherOf(entry, seen.path);
        return { id: entry.id, found: 'installed', launcher, icon: icons.get(seen.path) ?? null } satisfies Sighting;
      }
      return failures.length > 0
        ? ({ id: entry.id, found: 'failed', reason: failures.join('; ') } satisfies Sighting)
        : ({ id: entry.id, found: 'absent' } satisfies Sighting);
    },
    (effect, entry) =>
      Effect.catchTag(effect, 'PlatformError', (failure) =>
        Effect.succeed<Sighting>({ id: entry.id, found: 'failed', reason: failure.message }),
      ),
  );

  return EditorHost.of({
    find: Effect.fnUntraced(function* (entries) {
      const answer = yield* ask(entries.flatMap((entry) => entry.mac?.ids ?? []));
      return yield* Effect.forEach(entries, (entry) => sightingOf(entry, answer));
    }),
    opener: (url) => ({ program: OPEN, args: [url] }),
  });
});
