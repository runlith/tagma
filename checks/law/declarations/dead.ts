import type { Finding } from '@runlith/tagma/rules';
import type { Corpus, Package, WholeCorpus } from './corpus';
import type { DeadParams } from './declaration';
import type { ExportKind, Facts } from './facts';
import { matcher } from './glob';
import { type Resolver, resolverOf } from './resolve';

const ALL = '\0all';

const nodeOf = (path: string, name: string): string => `${path}\0${name}`;

const label = (kind: ExportKind, name: string): string => (kind === 'default' ? 'default export' : `${kind} \`${name}\``);

export type Consumption = readonly [target: string, name: string, runtime: boolean];

export const consumptions = function* (path: string, file: Facts, resolver: Resolver): Generator<Consumption> {
  const usesOf = new Map<string, (readonly [string, string])[]>();
  for (const [local, member, kind] of file.uses) {
    const held = usesOf.get(local);
    if (held === undefined) usesOf.set(local, [[member, kind]]);
    else held.push([member, kind]);
  }
  for (const one of file.imports)
    for (const target of resolver.resolve(one.specifier, path)) {
      if (target === path) continue;
      for (const binding of one.bindings) {
        const uses = usesOf.get(binding.local) ?? [];
        if (binding.imported !== '*') {
          yield [target, binding.imported, uses.some(([, kind]) => kind === 'v')];
          continue;
        }
        if (uses.length === 0) yield [target, ALL, false];
        for (const [member, kind] of uses) yield [target, member === '*' ? ALL : member, kind === 'v'];
      }
    }
  for (const one of file.forwards)
    for (const target of resolver.resolve(one.specifier, path)) {
      if (target === path) continue;
      if (one.names === 'all') yield [target, ALL, true];
      else for (const pair of one.names) yield [target, pair.imported === '*' ? ALL : pair.imported, true];
    }
  for (const one of file.loads)
    for (const target of one.pattern ? resolver.pattern(one.specifier, path) : resolver.resolve(one.specifier, path))
      if (target !== path) yield [target, ALL, true];
};

export const findDead = (corpus: WholeCorpus, params: DeadParams): readonly Finding[] => deadAmong(corpus, params, corpus.packages.all());

export const findDeadAmong = (corpus: Corpus, params: DeadParams, judged: ReadonlySet<string>): readonly Finding[] =>
  deadAmong(
    corpus,
    params,
    [...new Set([...judged].flatMap((path) => [...corpus.packages.containing(path), ...corpus.packages.targeting(path)]))],
    judged,
  );

const deadAmong = (corpus: Corpus, params: DeadParams, holders: readonly Package[], judged?: ReadonlySet<string>): readonly Finding[] => {
  const { facts, packages } = corpus;
  const resolver = resolverOf(new Set(facts.keys()), packages, params.aliases);
  const imported = new Set<string>();
  const called = new Set<string>();

  const consume = (path: string, name: string, runtime: boolean): void => {
    imported.add(nodeOf(path, name));
    if (runtime) called.add(nodeOf(path, name));
  };
  const consumeAll = (path: string): void => consume(path, ALL, true);

  for (const [path, file] of facts)
    for (const [target, name, runtime] of consumptions(path, file, resolver)) consume(target, name, runtime);

  const entry = matcher(params.entries);
  for (const path of facts.keys()) if (entry(path)) consumeAll(path);
  for (const pkg of holders) {
    const published = params.published.some((dir) => pkg.dir === dir || (dir !== '' && pkg.dir.startsWith(`${dir}/`)));
    for (const target of published ? resolver.exported(pkg) : pkg.entries.flatMap((one) => resolver.inside(pkg, one))) consumeAll(target);
  }

  const findings: Finding[] = [];
  const sorted = [...facts].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  for (const [path, file] of sorted) {
    if (judged !== undefined && !judged.has(path)) continue;
    if (!params.region.some((one) => path === one || path.startsWith(one))) continue;
    const wholly = imported.has(nodeOf(path, ALL));
    const everyCall = called.has(nodeOf(path, ALL));
    for (const exported of [...file.exports].sort((left, right) => left.line - right.line)) {
      if (!params.kinds.includes(exported.kind)) continue;
      const node = nodeOf(path, exported.name);
      const reached = wholly || imported.has(node);
      if (reached && (exported.kind !== 'function' || everyCall || called.has(node))) continue;
      findings.push({
        fingerprint: `dead ${path}#${exported.name}`,
        path,
        line: exported.line,
        message: reached
          ? `exported function \`${exported.name}\` has no production caller; production code only reaches it in type positions or reads its metadata`
          : `exported ${label(exported.kind, exported.name)} is imported by no production file`,
        fix: 'Delete it; drop `export` when its own file uses it. A test-only consumer is not a reason to export it.',
      });
    }
  }
  return findings;
};
