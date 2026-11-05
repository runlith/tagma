import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../../../core/languages';
import { baseOrRoot, defaulted, describeFiles, filesOrAll } from '../../../core/params';
import type { Shown } from '../../../core/rule';

const languages: Languages = 'any';

const files = filesOrAll(extensionsOf(languages));

const METRICS = { 'non-import': 'lines outside import statements' } as const;

const threshold = Schema.Struct({
  glob: Schema.NonEmptyString.annotate({
    description: 'A glob matched against the path relative to `base`; a file it matches is held to `lines`.',
  }),
  metric: defaulted(
    Schema.Literals(['non-import']).annotate({
      description:
        'What the language adapter measures in each file: `non-import` is its lines outside import statements, blank and comment lines included.',
    }),
    'non-import',
  ),
  lines: Schema.Int.check(Schema.isGreaterThan(0)).annotate({
    description: 'The ceiling on the metric: a file over it is a violation whose value is its measure.',
  }),
});

const params = Schema.Struct({
  base: baseOrRoot,
  files,
  thresholds: Schema.NonEmptyArray(threshold)
    .check(
      Schema.makeFilter((all) =>
        new Set(all.map((one) => `${one.metric} ${one.glob}`)).size === all.length ? undefined : 'a glob carries one threshold per metric',
      ),
    )
    .annotate({ description: 'The ceilings by glob; a file matching several is held to the lowest, and one matching none is not judged.' }),
});

type Params = typeof params.Type;

const describe = (value: Params): string =>
  [
    `Size ${describeFiles(value.base, value.files)}: a file holds at most its threshold, measured by its language's adapter. Thresholds:`,
    ...value.thresholds.map((one) => `- \`${one.glob}\`: ${one.lines} ${METRICS[one.metric]}.`),
  ].join('\n');

const shows = (value: Params): Shown => ({
  figures: [{ kind: 'thresholds', thresholds: value.thresholds.map(({ glob, metric, lines }) => ({ glob, metric, lines })) }],
});

export const size = {
  id: 'size',
  params,
  summary: 'A selected file holds at most the lines its threshold allows.',
  concern: 'size',
  describe,
  shows,
  languages,
  reach: 'local',
  fileLocal: true,
  calibrated: true,
  unit: 'file',
  follows: () => true,
  limitations: [
    "The metric is the adapter's: `size` parses nothing itself. `non-import` is a file's lines less the lines of its import statements, so rewriting imports never moves it. A file whose language has no adapter, or whose adapter measures no declarations, is named in `unjudged` with the reason, never counted as zero. A selected file the adapter reads and fails on — text that is not UTF-8 or does not parse — fails the whole inspection, never reads as clean; `files.exclude` naming it is the way past.",
    'A file matching several globs is held to the lowest of their thresholds.',
    'The fingerprint is the file relative to `base` and carries the measure as its value: a file in debt stands whatever its size becomes, and its value is only the measure recorded for it. A change that deletes a file and adds one with the same text outside its import statements carries its violation to the new path, and the verdict names the pair.',
    'A reading whose facts would pass the 120 s ask ceiling on this machine is refused as too large, never judged clean; the envelope is calibrated on the machine that judges from a cold parse of a bounded probe, which the server keeps per repository until it restarts and reuses only while the subject fits it.',
  ],
  unblock: [
    'Code of another subject moves to the file or module that owns it; a split follows named subjects, never the line count.',
    'A ceiling wrong for a class of files is changed for that class in its inspection in `tagma.config.ts`, on the operator’s word.',
  ],
} as const;
