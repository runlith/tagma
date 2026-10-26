import { ADAPTERS } from '@runlith/code-facts/adapters';
import { blobTree, type FacetMemo } from '@runlith/code-facts/blobs';
import type { Tree } from '@runlith/code-facts/tree';
import { join } from 'node:path';
import { Schema } from 'effect';
import type { Params } from '../../../builtins';
import { names as declared } from './declaration';
import { deriveCalibration, setCalibration, UNBOUNDED } from '../../../core/node/budget';
import { judge } from '../../../core/node/judge';
import { readNames } from './implementation';
import { commitTree } from '../../../core/node/sides';

type NameParams = Params<'names'>;

const REPOSITORY = join(import.meta.dir, '../../../../..');
const MIB = 1024 * 1024;
const RUNS = 3;
const CAP_MS = 120_000;
const FLOOR_MS = 10_000;
const LOWEST_CLASS = 4;
const MARGIN = 10;

const FILES = {
  extensions: ['.ts', '.tsx', '.svelte'],
  exclude: ['**/*.test.*', '**/*.itest.*', '**/*.stest.*', '**/*.spec.*', '**/*.bench.*', '**/*.generated.*', '**/*.d.ts', '**/*_pb.ts'],
};
const VERBS = [
  'read',
  'write',
  'get',
  'set',
  'list',
  'find',
  'make',
  'create',
  'build',
  'start',
  'run',
  'stop',
  'open',
  'close',
  'is',
  'has',
  'of',
  'for',
  'by',
  'to',
  'from',
  'with',
];

const gate = Schema.decodeUnknownSync(declared.params)({
  base: 'apps/tagma/server/src',
  files: FILES,
  uncovered: [],
  modules: [],
  services: ['Context.Service'],
  errors: ['Data.TaggedError'],
  checks: {
    F1: { exempt: [] },
    F2: { exempt: [] },
    F3: { lines: 200, excluded: [] },
    F4: { lines: 600, allowances: [] },
    S1: { words: 6, exempt: [] },
    S2: { prefix: 'Tagma', kernel: [], exempt: [] },
    S3: { suffixes: ['Owner'], exempt: [] },
    S4: { within: 'module', exempt: [] },
    S5: { heads: ['Manager', 'Helper', 'Util', 'Data'], allows: [], exempt: [] },
    S7a: { exempt: [] },
    S8: { conditions: ['Refused', 'Missing', 'Failed'], names: [], exempt: [] },
    S9: { id: 'tagma/{module}/{name}', suffixes: ['Owner', 'Service'], testing: ['**/*Fixture.ts'], exempt: [] },
  },
  glossary: [{ word: 'harness', meaning: 'an agent runtime', owner: 'threads', regions: ['threads/**'], reserved: true, retired: [] }],
});
const watch = Schema.decodeUnknownSync(declared.params)({
  ...gate,
  checks: {
    F5: { exports: 8 },
    F6: { files: 25 },
    F7: { exempt: [] },
    S1: { words: 5, exempt: [] },
    S4: { within: 'region', exempt: [] },
    S6: { exempt: [] },
    S7b: { exempt: [] },
    S10: { nouns: 3, verbs: VERBS, exempt: [] },
    S11: { participles: ['Done', 'Sent', 'Held'], exempt: [] },
  },
});

const timed = (work: () => unknown): number => {
  const started = Bun.nanoseconds();
  work();
  return (Bun.nanoseconds() - started) / 1e6;
};

const median = (runs: readonly number[]): number => [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)] as number;

type Subject = {
  readonly objects: Map<string, string>;
  readonly texts: Map<string, string>;
  readonly paths: readonly string[];
  readonly bytes: number;
  readonly lines: number;
};

const treeOf = (subject: Subject, facts: FacetMemo): Tree =>
  blobTree(subject.objects, subject.texts, new Map(), ADAPTERS, undefined, facts);

const both = (params: NameParams, tree: Tree, paths: readonly string[]) => {
  readNames(params, tree, paths, ADAPTERS, UNBOUNDED);
  readNames(watch.base === params.base ? watch : { ...watch, base: params.base }, tree, paths, ADAPTERS, UNBOUNDED);
};

const measure = (label: string, params: NameParams, subject: Subject) => {
  const cold = median(Array.from({ length: RUNS }, () => timed(() => both(params, treeOf(subject, new Map()), subject.paths))));
  const held: FacetMemo = new Map();
  both(params, treeOf(subject, held), subject.paths);
  const warm = median(Array.from({ length: RUNS }, () => timed(() => both(params, treeOf(subject, held), subject.paths))));
  console.log(
    `${label}: ${subject.paths.length} files, ${subject.lines} lines, ${(subject.bytes / MIB).toFixed(1)} MiB — cold ${cold.toFixed(0)} ms, warm ${warm.toFixed(0)} ms (median of ${RUNS}, gate and watch rules together)`,
  );
  return { cold, warm };
};

const subjectOf = (texts: ReadonlyMap<string, string>): Subject => {
  const objects = new Map<string, string>();
  const blobs = new Map<string, string>();
  let bytes = 0;
  let lines = 0;
  for (const [path, text] of texts) {
    const object = Bun.hash(text).toString(16);
    objects.set(path, object);
    blobs.set(object, text);
    bytes += Buffer.byteLength(text);
    lines += text.split('\n').length;
  }
  return { objects, texts: blobs, paths: [...objects.keys()], bytes, lines };
};

const synthetic = (base: string, files: number, functions: number): Subject => {
  const texts = new Map<string, string>();
  for (let at = 0; at < files; at += 1) {
    const module = `m${at % 27}`;
    const name = `Subject${at}`;
    const body = [
      "import { Context, Data } from 'effect';",
      `import { step0 as other } from '../m${(at + 1) % 27}/concept${Math.floor(at / 27) % 9}/file${at + 1}';`,
      `export class ${name}Missing extends Data.TaggedError('${name}Missing')<{ readonly at: string }> {}`,
      `export class ${name} extends Context.Service<${name}, { readonly read: (id: string) => number; readonly start: () => void }>()('tagma/${module}/${name}') {}`,
      `export type ${name}Refusal = 'gone' | 'held';`,
      `export const check${at} = (row: { readonly tag: string }): boolean => row.tag === 'note' && other(${at}) > 0;`,
    ];
    for (let fn = 0; fn < functions; fn += 1) {
      body.push(
        `export function step${fn}(value: number): number {`,
        `  const next = value + ${fn};`,
        '  if (next > 10) return next * 2;',
        '  return next;',
        '}',
      );
    }
    texts.set(`${base}/${module}/concept${Math.floor(at / 27) % 9}/file${at}.ts`, `${body.join('\n')}\n`);
  }
  return subjectOf(texts);
};

const own = (() => {
  const side = commitTree(REPOSITORY, 'HEAD', [gate.base], new Map(), new Map());
  const texts = new Map<string, string>();
  for (const path of side.paths) {
    if (!/\.(ts|tsx|svelte)$/.test(path) || /\.(test|itest|stest|spec|bench)\./.test(path)) continue;
    texts.set(path, side.tree.read(path));
  }
  return subjectOf(texts);
})();

const server = measure(`this repository, ${gate.base} at HEAD`, gate, own);
const smallSubject = synthetic('syn', 4000, 1);
const largeSubject = synthetic('syn', 400, 60);
const small = measure('synthetic, small files (1 function each)', { ...gate, base: 'syn' }, smallSubject);
const large = measure('synthetic, large files (60 functions each)', { ...gate, base: 'syn' }, largeSubject);
const target = measure(`synthetic at the 1M-LOC target`, { ...gate, base: 'syn' }, synthetic('syn', 6800, 28));
const [f1, m1, t1] = [smallSubject.paths.length, smallSubject.bytes / MIB, small.cold];
const [f2, m2, t2] = [largeSubject.paths.length, largeSubject.bytes / MIB, large.cold];
const perMib = (t2 * f1 - t1 * f2) / (m2 * f1 - m1 * f2);
const perFile = (t1 - perMib * m1) / f1;
const c = Math.max(perFile, 0) * MARGIN * LOWEST_CLASS;
const d = Math.max(perMib, 0) * MARGIN * LOWEST_CLASS;
const average = own.bytes / MIB / own.paths.length;
const files = Math.floor((CAP_MS - FLOOR_MS) / (c + d * average));
console.log(
  `cold cost here: ${perFile.toFixed(3)} ms per file + ${perMib.toFixed(1)} ms per MiB; with ×${MARGIN} margin and ×${LOWEST_CLASS} for the lowest class (not established): c = ${c.toFixed(2)} ms/file, d = ${d.toFixed(0)} ms/MiB`,
);
console.log(
  `envelope at this repository's mean file (${(average * 1024).toFixed(1)} KiB): ${files} files, ${(files * average).toFixed(0)} MiB under T_ask = 10 s + c·F + d·MiB ≤ 120 s`,
);

const largest = [...own.objects.keys()].sort(
  (left, right) => (own.texts.get(own.objects.get(right) ?? '')?.length ?? 0) - (own.texts.get(own.objects.get(left) ?? '')?.length ?? 0),
);
const LANDING = largest.slice(0, 4);
setCalibration('names', deriveCalibration(small.cold, smallSubject.paths.length, smallSubject.bytes));
const words = new Map<string, Set<string>>();
for (const [path, object] of own.objects) {
  for (const [word] of (own.texts.get(object) ?? '').matchAll(/[A-Za-z_$][\w$]*|'[^'\n]*'/g)) {
    const key = word.startsWith("'") ? word.slice(1, -1) : word;
    const held = words.get(key);
    if (held === undefined) words.set(key, new Set([path]));
    else held.add(path);
  }
}
const landingTree = (facts: FacetMemo): Tree => ({
  ...blobTree(own.objects, own.texts, new Map(), ADAPTERS, undefined, facts),
  mentions: (asked) => new Set(asked.flatMap((word) => [...(words.get(word) ?? [])])),
});
const inspection = { builtin: 'names', params: gate } as const;
const coldLanding = median(
  Array.from({ length: RUNS }, () =>
    timed(() => judge(inspection, { base: landingTree(new Map()), built: landingTree(new Map()), paths: LANDING }, [])),
  ),
);
const heldFacts: FacetMemo = new Map();
judge(inspection, { base: landingTree(heldFacts), built: landingTree(heldFacts), paths: LANDING }, []);
const warmLanding = median(
  Array.from({ length: RUNS }, () =>
    timed(() => judge(inspection, { base: landingTree(heldFacts), built: landingTree(heldFacts), paths: LANDING }, [])),
  ),
);
console.log(
  `a landing of the ${LANDING.length} largest server files judged by the gate rule, other declarers found by mentions: cold ${coldLanding.toFixed(0)} ms, warm ${warmLanding.toFixed(1)} ms`,
);
console.log(
  `(one sample on this machine; server ${server.cold.toFixed(0)} / ${server.warm.toFixed(0)} ms, 1M-LOC ${target.cold.toFixed(0)} / ${target.warm.toFixed(0)} ms cold / warm)`,
);
