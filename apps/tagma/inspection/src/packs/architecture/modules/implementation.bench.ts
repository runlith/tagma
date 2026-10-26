import { ADAPTERS } from '@runlith/code-facts/adapters';
import { blobTree, type ParseMemo } from '@runlith/code-facts/blobs';
import { importsOf, type Tree } from '@runlith/code-facts/tree';
import { join } from 'node:path';
import { Schema } from 'effect';
import { type Assembled, BUILTINS } from '../../../builtins';
import { moduleMapSchema } from '../../../core/rule';
import { modules as declared } from './declaration';
import { inspect, selects } from '../../../core/node/implementations';
import { judge } from '../../../core/node/judge';
import { liveAssembledParams } from './liveRule';
import { commitTree } from '../../../core/node/sides';

const REPOSITORY = join(import.meta.dir, '../../../../..');
const MODULES_KEY = 'modules';
const SNAPSHOT = 'the modules rule in the graph';
const MIB = 1024 * 1024;
const RUNS = 5;
const CAP_MS = 120_000;
const FLOOR_MS = 10_000;
const LOWEST_CLASS = 4;
const MARGIN = 10;

type Subject = {
  readonly objects: Map<string, string>;
  readonly texts: Map<string, string>;
  readonly paths: readonly string[];
  readonly bytes: number;
};

const subjectOf = (files: ReadonlyMap<string, string>): Subject => {
  const objects = new Map<string, string>();
  const texts = new Map<string, string>();
  let bytes = 0;
  for (const [path, text] of files) {
    const object = Bun.hash(text).toString(16);
    objects.set(path, object);
    texts.set(object, text);
    bytes += Buffer.byteLength(text);
  }
  return { objects, texts, paths: [...files.keys()], bytes };
};

const treeOf = (subject: Subject, memo: ParseMemo): Tree => blobTree(subject.objects, subject.texts, memo, ADAPTERS);

const timed = (work: () => unknown): number => {
  const started = Bun.nanoseconds();
  work();
  return (Bun.nanoseconds() - started) / 1e6;
};

const median = (runs: readonly number[]): number => [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)] as number;

const cold = (inspection: Assembled, subject: Subject, paths: readonly string[]): number =>
  median(Array.from({ length: RUNS }, () => timed(() => inspect(inspection, treeOf(subject, new Map()), paths))));

const SYNTHETIC_MODULES = 10;

const synthetic = (files: number, functions: number): { readonly inspection: Assembled; readonly subject: Subject } => {
  const map = Schema.decodeUnknownSync(moduleMapSchema)({
    modules: Array.from({ length: SYNTHETIC_MODULES }, (_, at) => ({ id: `m${at}`, territory: [`syn/m${at}/`] })),
    relations: Array.from({ length: SYNTHETIC_MODULES - 1 }, (_, at) => ({ from: `m${at + 1}`, to: `m${at}` })),
    region: ['syn/'],
  });
  const params = Schema.decodeUnknownSync(declared.params)({
    base: 'syn',
    cycles: 'refuse',
    coverage: 'refuse',
    unresolved: 'refuse',
    reads: 'every',
    files: { extensions: ['.ts'], exclude: [] },
  });
  const body = Array.from(
    { length: functions },
    (_, at) =>
      `export function f${at}(value: number): number {\n  const next = value * ${at + 1};\n  return next > 10 ? next - ${at} : next + ${at};\n}\n`,
  ).join('');
  const texts = new Map<string, string>();
  for (let at = 0; at < files; at += 1) {
    const module = at % SYNTHETIC_MODULES;
    const lower = Math.max(0, module - 1);
    const imports = [0, 1, 2]
      .map((one) => `import { f0 as g${one} } from '../m${one === 0 ? module : lower}/f${(at + one * 7) % files}';\n`)
      .join('');
    texts.set(`syn/m${module}/f${at}.ts`, `${imports}${body}`);
  }
  return { inspection: { builtin: 'modules', params: { ...params, map } }, subject: subjectOf(texts) };
};

const small = synthetic(4000, 1);
const large = synthetic(400, 60);
const [f1, m1, t1] = [small.subject.paths.length, small.subject.bytes / MIB, cold(small.inspection, small.subject, small.subject.paths)];
const [f2, m2, t2] = [large.subject.paths.length, large.subject.bytes / MIB, cold(large.inspection, large.subject, large.subject.paths)];
const perMib = (t2 * f1 - t1 * f2) / (m2 * f1 - m1 * f2);
const perFile = (t1 - perMib * m1) / f1;
const c = Math.max(perFile, 0) * MARGIN * LOWEST_CLASS;
const d = Math.max(perMib, 0) * MARGIN * LOWEST_CLASS;

const live = liveAssembledParams(REPOSITORY, MODULES_KEY) as { readonly map: unknown };
const inspection: Assembled = {
  builtin: 'modules',
  params: { ...Schema.decodeUnknownSync(BUILTINS.modules.params)(live), map: Schema.decodeUnknownSync(moduleMapSchema)(live.map) },
};
const side = commitTree(REPOSITORY, 'HEAD', [''], new Map(), new Map());
const own = new Map<string, string>();
for (const path of side.paths) own.set(path, side.tree.read(path));
const repository = subjectOf(own);
const selected = repository.paths.filter((path) => selects(inspection, path)).sort();
const selectedBytes = selected.reduce((sum, path) => sum + Buffer.byteLength(own.get(path) as string), 0);
const average = selectedBytes / MIB / selected.length;
const envelope = Math.floor((CAP_MS - FLOOR_MS) / (c + d * average));

const whole = cold(inspection, repository, selected);
const held: ParseMemo = new Map();
inspect(inspection, treeOf(repository, held), selected);
const memoised = median(Array.from({ length: RUNS }, () => timed(() => inspect(inspection, treeOf(repository, held), selected))));

const edited = selected.filter((path) => /\.ts$/.test(path) && !/\.(test|itest|stest|spec|bench)\./.test(path)).slice(0, 4);
const importedBy = new Map<string, number>();
const probe = treeOf(repository, held);
for (const path of selected.slice(0, 400)) {
  for (const { specifier } of importsOf(probe, path, 'every', ADAPTERS)) {
    if (!specifier.startsWith('.')) continue;
    const to = join(path, '..', specifier).replace(/\.js$/, '.ts');
    if (repository.objects.has(to)) importedBy.set(to, (importedBy.get(to) ?? 0) + 1);
  }
}
const removed = [...importedBy].sort((a, b) => b[1] - a[1])[0]?.[0];
if (removed === undefined) throw new Error('no imported file to remove');
const without = subjectOf(new Map([...own].filter(([path]) => path !== removed)));
const added = edited[0]?.replace(/\.ts$/, '.added.ts') as string;
const plus = subjectOf(new Map([...own, [added, own.get(edited[0] as string) as string]]));
const touched = subjectOf(
  new Map([...own].map(([path, text]) => [path, edited.includes(path) ? `${text}\nexport const touched = 1;\n` : text])),
);

const landing = (label: string, built: Subject, paths: readonly string[]) => {
  const fresh = median(
    Array.from({ length: RUNS }, () => {
      const shared: ParseMemo = new Map();
      return timed(() => judge(inspection, { base: treeOf(repository, shared), built: treeOf(built, shared), paths }, []));
    }),
  );
  const memo: ParseMemo = new Map();
  judge(inspection, { base: treeOf(repository, memo), built: treeOf(built, memo), paths }, []);
  const warm = median(
    Array.from({ length: RUNS }, () =>
      timed(() => judge(inspection, { base: treeOf(repository, memo), built: treeOf(built, memo), paths }, [])),
    ),
  );
  console.log(
    `landing ${label}: cold (one parse memo for both sides, as the worker holds) ${fresh.toFixed(1)} ms, parses memoised ${warm.toFixed(1)} ms (medians of ${RUNS})`,
  );
};

console.log(
  `synthetic, ${f1} small files (${m1.toFixed(1)} MiB): ${t1.toFixed(0)} ms cold; ${f2} large files (${m2.toFixed(1)} MiB): ${t2.toFixed(0)} ms cold`,
);
console.log(
  `cold cost here: ${perFile.toFixed(3)} ms per file + ${perMib.toFixed(1)} ms per MiB; ×${MARGIN} margin, ×${LOWEST_CLASS} for the lowest class (not established): c = ${c.toFixed(2)} ms/file, d = ${d.toFixed(0)} ms/MiB`,
);
console.log(
  `envelope at this snapshot's mean file (${(average * 1024).toFixed(1)} KiB): ${envelope} files, ${(envelope * average).toFixed(0)} MiB under T_ask = 10 s + c·F + d·MiB ≤ 120 s`,
);
console.log(
  `this repository at HEAD under ${SNAPSHOT}: ${selected.length} files, ${(selectedBytes / MIB).toFixed(1)} MiB — whole reach ${whole.toFixed(0)} ms cold, ${memoised.toFixed(0)} ms with parses memoised`,
);
landing(`editing ${edited.length} files`, touched, edited);
landing(`adding ${added}`, plus, [added]);
landing(`removing ${removed}, imported by ${importedBy.get(removed)} files`, without, [removed]);
