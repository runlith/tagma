import type { Assembled } from '@tagma/inspection/builtins';
import {
  deriveCalibration,
  fitsCalibration,
  isCalibratedBuiltin,
  probeOf,
  spreadProbe,
  type Calibration,
} from '@tagma/inspection/node/budget';
import { facetFor, selects } from '@tagma/inspection/node/implementations';
import { MEMO_BYTES } from '@tagma/inspection/node/memo';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { blobTree, type FacetMemo, parseAhead } from '@runlith/code-facts/blobs';
import { facetOf } from '@runlith/code-facts/tree';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import type { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import type { InspectionCache } from './caches.js';
import { parses } from './parses.js';
import { fetchedBlobs, type Side, texts } from './sides.js';
import { unreadFrom } from './unread.js';

const remembered = new Map<string, Calibration>();
const CALIBRATIONS_KEPT = Math.floor(MEMO_BYTES / 1024);

const rememberCalibration = (key: string, calibration: Calibration): void => {
  remembered.delete(key);
  remembered.set(key, calibration);
  if (remembered.size > CALIBRATIONS_KEPT) remembered.delete(remembered.keys().next().value as string);
};

export const subjectOf = (sides: readonly Side[]): { readonly files: number; readonly bytes: number } => {
  let files = 0;
  let bytes = 0;
  for (const side of sides) {
    files += side.paths.length;
    for (const path of side.paths) bytes += side.listed.sizes.get(path) ?? 0;
  }
  return { files, bytes };
};

const probeSidesOf = (inspection: Assembled, sides: readonly Side[]): readonly Side[] => {
  const rest = function* (): Iterable<string> {
    for (const path of sides.at(-1)?.listed.ordered ?? []) if (selects(inspection, path)) yield path;
  };
  const paths = probeOf(
    sides.flatMap((side) => side.paths),
    rest(),
    (path) => sides.reduce((sum, side) => sum + (side.listed.sizes.get(path) ?? 0), 0),
  );
  const spread = spreadProbe(
    paths,
    sides.map((side) => ({ object: (path: string) => side.listed.objects.get(path), size: (path: string) => side.listed.sizes.get(path) })),
  );
  return sides.map((side, at) => ({ ...side, paths: spread.held[at] ?? [] }));
};

export const ensureCalibration = Effect.fn('inspecting.ensureCalibration')(function* (
  git: Git['Service'],
  root: string,
  inspection: Assembled,
  sides: readonly Side[],
  cache: InspectionCache | undefined,
) {
  if (!isCalibratedBuiltin(inspection.builtin)) return undefined;
  const key = `${root}\0${inspection.builtin}`;
  const full = subjectOf(sides);
  const held = remembered.get(key);
  if (held !== undefined) {
    rememberCalibration(key, held);
    return held;
  }
  const stored = cache?.calibration.get(inspection.builtin);
  if (stored !== undefined && fitsCalibration(stored, full.files, full.bytes)) {
    const calibration: Calibration = {
      cbMsPerFile: stored.cbMsPerFile,
      dbMsPerMib: stored.dbMsPerMib,
      probeMs: stored.probeMs,
      probeFiles: stored.probeFiles,
      probeMib: stored.probeMib,
    };
    rememberCalibration(key, calibration);
    return calibration;
  }
  const probe = probeSidesOf(inspection, sides);
  const seen = subjectOf(probe);
  if (seen.files === 0) return undefined;
  const started = performance.now();
  const fetched = yield* texts(git, root, probe);
  const facet = facetFor(inspection.builtin);
  if (facet !== undefined) {
    yield* Effect.try({
      try: () => {
        const cold: FacetMemo = new Map();
        for (const side of probe) {
          const tree = blobTree(side.listed.objects, fetched.held, new Map(), ADAPTERS, undefined, cold);
          for (const path of side.paths) {
            try {
              facetOf(tree, path, facet, ADAPTERS);
            } catch (error) {
              if (!(error instanceof UnsupportedSource)) throw error;
            }
          }
        }
      },
      catch: unreadFrom,
    });
  } else {
    const imports = cache?.parses ?? parses;
    const blobs = fetchedBlobs(probe, fetched.held);
    yield* Effect.promise(() => parseAhead(imports, ADAPTERS, blobs)).pipe(
      Effect.withSpan('inspecting.parse', { attributes: { files: blobs.length } }),
    );
  }
  const elapsed = performance.now() - started;
  const calibration = deriveCalibration(elapsed, seen.files, seen.bytes);
  rememberCalibration(key, calibration);
  cache?.calibration.set(inspection.builtin, calibration);
  cache?.flush();
  return calibration;
});
