import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { HeadSide, IntroducedStep, IntroducedVerdicts } from '../contract/service/holdings.js';
import { contentOf, type Content } from '../lines/folding.js';
import type { Verdict } from '../lines/projection.js';
import { assembled, blobContents, type BlobRead, type Checkout, conversionsOf, type InputReaders, rowsAt, textsOf } from './inputs.js';
import { headsAt } from './heads.js';
import type { Folder } from './judge.js';
import { lastWriter } from '../lines/fold.js';
import { hunksOf } from '../record/hunks.js';

type Sided = { readonly path: string; readonly before: HeadSide; readonly after: HeadSide };

const keyOf = (path: string, blob: string): string => `${blob}\0${path}`;

export const introduced = Effect.fnUntraced(function* <E>(
  readers: InputReaders,
  folder: Folder,
  checkout: Checkout,
  steps: readonly IntroducedStep[],
  decide: IntroducedVerdicts<E>,
): Effect.fn.Return<void, StoreFailure | E> {
  const paths = [...new Set(steps.flatMap((step) => [...step.paths.keys()]))];
  if (paths.length === 0) return;
  const rows = yield* rowsAt(readers, checkout.rootId, paths);
  const sided = new Map<IntroducedStep, readonly Sided[]>();
  for (const step of steps) {
    const asked = [...step.paths.keys()].filter((path) => rows.has(path));
    const landed = step.tree === null || asked.length === 0 ? null : yield* headsAt(readers.git, checkout.dir, step.tree, asked);
    sided.set(
      step,
      asked.map((path) => {
        const sides = step.paths.get(path)!;
        return { path, before: sides.before, after: landed?.get(path) ?? sides.after };
      }),
    );
  }
  const reads = new Map<string, BlobRead>();
  for (const one of [...sided.values()].flat())
    for (const side of [one.before, one.after])
      if (side.kind === 'blob') reads.set(keyOf(one.path, side.oid), { path: one.path, blob: side.oid });
  const known = yield* conversionsOf(readers, checkout, [...new Set([...reads.values()].map((one) => one.path))]);
  const asked = [...reads.values()];
  const contents =
    asked.length === 0
      ? []
      : yield* blobContents(readers, checkout.dir, asked, 'later', known._tag === 'Success' ? known.success : undefined);
  const read = new Map(asked.map((one, at) => [keyOf(one.path, one.blob), contents[at]] as const));
  const contentAt = (path: string, side: HeadSide): Content => {
    if (side.kind === 'unread') return { kind: 'unread', cause: side.cause };
    if (side.kind === 'absent') return contentOf(null);
    const content = read.get(keyOf(path, side.oid));
    return content === undefined || content === 'oversized' ? { kind: 'whole', digest: `blob:${side.oid}` } : content;
  };
  const versions = yield* textsOf(readers, [...rows.values()].flat());
  const hunks = yield* hunksOf(readers.units, readers.store, [...rows.values()].flat(), versions);
  const gone = new Set<string>();
  for (const step of steps) {
    const standing = (sided.get(step) ?? []).flatMap((one) => {
      const own = (rows.get(one.path) ?? []).filter((row) => !gone.has(row.id));
      return own.length === 0
        ? []
        : [{ path: one.path, rows: own, head: contentAt(one.path, one.before), working: contentAt(one.path, one.after) }];
    });
    const verdicts = new Map<string, Verdict>();
    if (standing.length > 0) {
      const prepared = yield* assembled(readers, checkout.dir, standing, 'later', known, versions, hunks);
      for (const [path, { input }] of prepared) {
        const folded = yield* Effect.result(folder(input, undefined, undefined, 'later'));
        const verdict: Verdict =
          folded._tag === 'Success'
            ? folded.success.result
            : {
                verdict: 'unknown',
                reason: 'unread',
                side: 'working',
                cause: folded.failure.reason,
                writers: input.rows.flatMap((row) => (input.ended?.has(row.id) === true ? [] : [{ row: row.id, holder: row.holder }])),
              };
        verdicts.set(
          path,
          verdict.verdict === 'unknown' && verdict.reason === 'opaque' && input.head.kind !== 'unread' && input.working.kind !== 'unread'
            ? lastWriter(input)
            : verdict,
        );
      }
    }
    for (const id of yield* decide(step, verdicts)) gone.add(id);
  }
});
