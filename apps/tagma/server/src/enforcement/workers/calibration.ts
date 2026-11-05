import type { Assembled } from '@tagma/inspection/builtins';
import { type Calibration, calibratingOf, deriveCalibration, type ProbeSide, type Subject, subjectOf } from '@tagma/inspection/node/budget';
import { facetFor } from '@tagma/inspection/node/implementations';
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

const probeSidesOf = (sides: readonly Side[]): readonly ProbeSide[] =>
  sides.map((side) => ({ object: (path: string) => side.listed.objects.get(path), size: (path: string) => side.listed.sizes.get(path) }));

export const subjectAt = (sides: readonly Side[]): Subject =>
  subjectOf(
    sides.flatMap((side) => side.paths),
    probeSidesOf(sides),
  );

const storedAt = (cache: InspectionCache | undefined, builtin: string): Calibration | undefined => {
  const stored = cache?.calibration.get(builtin);
  return stored === undefined
    ? undefined
    : {
        cbMsPerFile: stored.cbMsPerFile,
        dbMsPerMib: stored.dbMsPerMib,
        probeMs: stored.probeMs,
        probeFiles: stored.probeFiles,
        probeMib: stored.probeMib,
      };
};

export const ensureCalibration = Effect.fn('inspecting.ensureCalibration')(function* (
  git: Git['Service'],
  root: string,
  inspection: Assembled,
  sides: readonly Side[],
  cache: InspectionCache | undefined,
) {
  const key = `${root}\0${inspection.builtin}`;
  const calibrating = calibratingOf(
    inspection,
    sides.flatMap((side) => side.paths),
    probeSidesOf(sides),
    sides.at(-1)?.listed.ordered ?? [],
    remembered.get(key) ?? storedAt(cache, inspection.builtin),
  );
  if (calibrating.kind === 'none') return undefined;
  if (calibrating.kind === 'known') {
    rememberCalibration(key, calibrating.calibration);
    return calibrating.calibration;
  }
  const probe = sides.map((side, at) => ({ ...side, paths: calibrating.probe.held[at] ?? [] }));
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
  const calibration = deriveCalibration(performance.now() - started, calibrating.probe.files, calibrating.probe.bytes);
  rememberCalibration(key, calibration);
  cache?.calibration.set(inspection.builtin, calibration);
  cache?.flush();
  return calibration;
});
