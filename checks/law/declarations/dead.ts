import type { Finding } from '@runlith/tagma/rules';
import type { Corpus } from './corpus';
import type { DeadParams } from './declaration';
import type { ExportKind, Exported } from './facts';
import { matcher } from './glob';
import { resolverOf } from './resolve';

const ALL = '\0all';

const nodeOf = (path: string, name: string): string => `${path}\0${name}`;

const label = (kind: ExportKind, name: string): string => (kind === 'default' ? 'default export' : `${kind} \`${name}\``);

export type Scope = { readonly judged: ReadonlySet<string>; readonly rooted: ReadonlySet<string> };

export const findDead = (corpus: Corpus, params: DeadParams, scope?: Scope): readonly Finding[] => {
  const { facts, packages } = corpus;
  const resolver = resolverOf(new Set(facts.keys()), packages, params.aliases);
  const exportsOf = new Map<string, Map<string, Exported>>();
  for (const [path, file] of facts) exportsOf.set(path, new Map(file.exports.map((one) => [one.name, one])));
  const live = new Set<string>();
  const everything = new Set<string>();
  const queue: string[] = [];
  const depends = new Map<string, string[]>();
  const imported = new Set<string>();
  const loaded = new Set<string>();

  const mark = (path: string, name: string): void => {
    if (!facts.has(path)) return;
    const node = nodeOf(path, name);
    if (live.has(node)) return;
    live.add(node);
    queue.push(node);
  };
  const markAll = (path: string): void => {
    if (!facts.has(path) || everything.has(path)) return;
    everything.add(path);
    for (const name of exportsOf.get(path)!.keys()) mark(path, name);
    mark(path, ALL);
  };
  const need = (path: string, name: string, within: string, to: string): void => {
    if (within === '') {
      if (name === ALL) markAll(to);
      else mark(to, name);
      return;
    }
    const node = nodeOf(path, within);
    const held = depends.get(node);
    const target = nodeOf(to, name);
    if (held === undefined) depends.set(node, [target]);
    else held.push(target);
  };

  for (const [path, file] of facts) {
    const usesOf = new Map<string, (readonly [string, string])[]>();
    for (const [local, member, within] of file.uses) {
      const held = usesOf.get(local);
      if (held === undefined) usesOf.set(local, [[member, within]]);
      else held.push([member, within]);
    }
    for (const one of file.imports) {
      const targets = resolver.resolve(one.specifier, path);
      for (const target of targets) {
        if (target !== path) loaded.add(target);
        for (const binding of one.bindings) {
          const uses = usesOf.get(binding.local) ?? [];
          if (binding.imported === '*') {
            for (const [member, within] of uses) {
              if (member !== '*') imported.add(nodeOf(target, member));
              need(path, member === '*' ? ALL : member, within, target);
            }
          } else {
            imported.add(nodeOf(target, binding.imported));
            for (const [, within] of uses) need(path, binding.imported, within, target);
          }
        }
      }
    }
    for (const one of file.forwards) for (const target of resolver.resolve(one.specifier, path)) loaded.add(target);
    for (const one of file.loads) {
      const targets = one.pattern ? resolver.pattern(one.specifier, path) : resolver.resolve(one.specifier, path);
      for (const target of targets) {
        loaded.add(target);
        markAll(target);
      }
    }
  }

  const entry = matcher(params.entries);
  for (const path of facts.keys())
    if (entry(path)) {
      loaded.add(path);
      markAll(path);
    }
  for (const pkg of packages) {
    const published = params.published.some((dir) => pkg.dir === dir || (dir !== '' && pkg.dir.startsWith(`${dir}/`)));
    const targets = published ? [...resolver.exported(pkg)] : pkg.entries.flatMap((one) => resolver.inside(pkg, one));
    for (const target of targets) {
      loaded.add(target);
      markAll(target);
    }
  }
  for (const path of scope?.rooted ?? [])
    if (facts.has(path)) {
      loaded.add(path);
      markAll(path);
    }
  const orphans = new Set<string>();
  for (const path of facts.keys())
    if (!loaded.has(path)) {
      orphans.add(path);
      markAll(path);
    }

  const forwarded = (path: string, name: string): void => {
    for (const one of facts.get(path)!.forwards) {
      const targets = resolver.resolve(one.specifier, path);
      if (one.names === 'all') {
        if (name === ALL) for (const target of targets) markAll(target);
        else if (!exportsOf.get(path)!.has(name)) for (const target of targets) mark(target, name);
        continue;
      }
      for (const pair of one.names)
        if (name === ALL || pair.exported === name)
          for (const target of targets) {
            if (pair.imported === '*') markAll(target);
            else mark(target, pair.imported);
          }
    }
  };

  for (let at = 0; at < queue.length; at++) {
    const node = queue[at]!;
    const split = node.indexOf('\0');
    const path = node.slice(0, split);
    const name = node.slice(split + 1);
    for (const target of depends.get(node) ?? []) {
      const [to, wanted] = [target.slice(0, target.indexOf('\0')), target.slice(target.indexOf('\0') + 1)];
      if (wanted === ALL) markAll(to);
      else mark(to, wanted);
    }
    if (name === ALL) {
      for (const exported of exportsOf.get(path)!.keys()) mark(path, exported);
      forwarded(path, ALL);
    } else forwarded(path, name);
  }

  const inRegion = (path: string): boolean =>
    (scope === undefined || scope.judged.has(path)) && params.region.some((one) => path === one || path.startsWith(one));
  const findings: Finding[] = [];
  for (const [path, file] of [...facts].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    if (!inRegion(path)) continue;
    if (orphans.has(path)) {
      findings.push({
        fingerprint: `dead-file ${path}`,
        path,
        line: 1,
        message: 'no production file imports, loads or declares this file as an entry',
        fix: 'Delete the file, or declare it an entry (`entries`) when a tool, a manifest or a bundler starts it.',
      });
      continue;
    }
    for (const exported of [...file.exports].sort((left, right) => left.line - right.line)) {
      const node = nodeOf(path, exported.name);
      if (live.has(node) || !params.kinds.includes(exported.kind)) continue;
      const reached = imported.has(node);
      findings.push({
        fingerprint: `dead ${path}#${exported.name}`,
        path,
        line: exported.line,
        message: reached
          ? exported.kind === 'function'
            ? `exported function \`${exported.name}\` has no production caller; only dead code or tests reach it`
            : `exported ${label(exported.kind, exported.name)} is reached only from dead code or tests`
          : `exported ${label(exported.kind, exported.name)} is imported by no production file`,
        fix: 'Delete it; drop `export` when its own file uses it. A test-only consumer is not a reason to export it.',
      });
    }
  }
  return findings;
};
