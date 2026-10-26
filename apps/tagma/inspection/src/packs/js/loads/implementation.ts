import { js } from '@runlith/code-facts/adapters';
import { resolveRelative } from '@runlith/code-facts/js/resolve';
import { workspaceOf } from '@runlith/code-facts/js/workspace';
import { runtimeNamed } from '@runlith/code-facts/runtimes';
import { importsOf, type Tree } from '@runlith/code-facts/tree';
import type { Implementation } from '../../../core/node/reading';
import { localOf, picks, prefixOf } from '../../../core/node/select';
import type { Unjudged, Violation } from '../../../core/verdict';
import { fromOf, narrowing, type Run as Of, refusalOf } from './declaration';

type Hop = { readonly line: number; readonly specifier: string };
type Edge = Hop & { readonly to: string };
type Sink = Hop & { readonly entry: string };
type File = { readonly edges: Edge[]; readonly sinks: Sink[] };

const covered = (entry: string) => (at: string) => at === entry || at.startsWith(`${entry.replace(/\/$/, '')}/`);

const selects = (params: Of, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && fromOf(params).some((entry) => covered(entry)(local)) && picks(params.files, local);
};

const walk = (params: Of, tree: Tree, starts: readonly string[]) => {
  const refused = refusalOf(params.refuses, params.allows);
  const workspace = workspaceOf(
    tree,
    params.base,
    params.conditions,
    new Map((params.built ?? []).map(({ output, source }) => [`${prefixOf(params.base)}${output}`, `${prefixOf(params.base)}${source}`])),
    (params.runtimes ?? []).map((id) => runtimeNamed(id)!),
  );
  let members: readonly string[] | undefined;
  const member = (specifier: string): boolean => {
    members ??= workspace.manifests().map(({ name }) => name);
    return members.some((name) => specifier === name || specifier.startsWith(`${name}/`));
  };
  const files = new Map<string, File>();
  const unjudged: Unjudged[] = [];
  const queue = [...starts];
  for (let next = 0; next < queue.length; next += 1) {
    const file = queue[next] as string;
    if (files.has(file)) continue;
    const held: File = { edges: [], sinks: [] };
    files.set(file, held);
    for (const { specifier, line } of importsOf(tree, file, params.reads, [js])) {
      const entry = refused(specifier);
      if (entry !== undefined) {
        held.sinks.push({ line, specifier, entry });
        continue;
      }
      let to: string | null;
      if (specifier.startsWith('.')) to = resolveRelative(specifier, file, tree);
      else if (specifier.startsWith('#') || specifier.startsWith('/')) to = null;
      else {
        const door = workspace.resolve(specifier);
        if (door === null || ('unlisted' in door && !member(specifier))) continue;
        to = 'to' in door ? door.to : null;
      }
      if (to === null) unjudged.push({ file, line, specifier });
      else if (js.parses(to)) {
        held.edges.push({ line, specifier, to });
        queue.push(to);
      }
    }
  }
  return { files, unjudged };
};

const importersOf = (files: ReadonlyMap<string, File>): ReadonlyMap<string, readonly string[]> => {
  const importers = new Map<string, string[]>();
  for (const [file, { edges }] of files) {
    for (const { to } of edges) {
      const held = importers.get(to);
      if (held === undefined) importers.set(to, [file]);
      else held.push(file);
    }
  }
  return importers;
};

const distances = (
  files: ReadonlyMap<string, File>,
  importers: ReadonlyMap<string, readonly string[]>,
  entry: string,
): ReadonlyMap<string, number> => {
  const reached = new Map<string, number>();
  const queue = [...files].filter(([, { sinks }]) => sinks.some((sink) => sink.entry === entry)).map(([file]) => file);
  for (const file of queue) reached.set(file, 1);
  for (let next = 0; next < queue.length; next += 1) {
    const file = queue[next] as string;
    const far = (reached.get(file) as number) + 1;
    for (const importer of importers.get(file) ?? []) {
      if (reached.has(importer)) continue;
      reached.set(importer, far);
      queue.push(importer);
    }
  }
  return reached;
};

const fixOf = (params: Of, entry: string, sink: Sink, loader: string, first: Hop | undefined): string => {
  const doors = narrowing(params.allows, entry);
  const instead = doors.length === 0 ? undefined : `load ${doors.map((one) => `\`${one}\``).join(' or ')} instead of \`${sink.specifier}\``;
  const away = 'move the code that needs it out of what `from` selects';
  if (first === undefined)
    return instead === undefined
      ? `Remove this load of \`${sink.specifier}\`, or ${away}.`
      : `${instead[0]!.toUpperCase()}${instead.slice(1)}.`;
  return instead === undefined
    ? `Cut the chain at its first hop \`${first.specifier}\`, or ${away}.`
    : `In \`${loader}\`, ${instead}, or cut the chain at its first hop \`${first.specifier}\`.`;
};

const violationOf = (
  params: Of,
  files: ReadonlyMap<string, File>,
  reached: ReadonlyMap<string, number>,
  start: string,
  entry: string,
): Violation => {
  const passed: string[] = [];
  let first: Hop | undefined;
  let at = start;
  for (;;) {
    const held = files.get(at) as File;
    const far = reached.get(at) as number;
    if (far === 1) {
      const sink = held.sinks.find((one) => one.entry === entry) as Sink;
      return {
        fingerprint: `${localOf(params.base, start) ?? start} -> ${entry}`,
        file: start,
        line: (first ?? sink).line,
        specifier: (first ?? sink).specifier,
        chain: [...passed, sink.specifier],
        message: `loads \`${sink.specifier}\``,
        fix: fixOf(params, entry, sink, at, first),
      };
    }
    const edge = held.edges.find(({ to }) => reached.get(to) === far - 1) as Edge;
    first ??= edge;
    passed.push(edge.to);
    at = edge.to;
  }
};

export const loads: Implementation<Of> = {
  lists: () => [''],
  selects,
  read: (params, tree, paths) => {
    const starts = [...new Set(paths.filter((path) => selects(params, path)))].sort();
    if (starts.length === 0) return { violations: [], unjudged: [] };
    const { files, unjudged } = walk(params, tree, starts);
    const entries = [...new Set([...files.values()].flatMap(({ sinks }) => sinks.map(({ entry }) => entry)))].sort();
    const importers = importersOf(files);
    const reaches = entries.map((entry) => ({ entry, reached: distances(files, importers, entry) }));
    const violations = starts.flatMap((start) =>
      reaches.flatMap(({ entry, reached }) => (reached.has(start) ? [violationOf(params, files, reached, start, entry)] : [])),
    );
    return { violations, unjudged };
  },
};
