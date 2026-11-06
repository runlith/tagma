import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADAPTERS } from '../../packages/code-facts/src/languages/adapters';
import { blobTree } from '../../packages/code-facts/src/blobs';
import { OUTLINE } from '../../packages/code-facts/src/languages/js/index';
import { facetOf, type Tree } from '../../packages/code-facts/src/tree';
import { names, readNames } from '../../apps/tagma/inspection/src/packs/architecture/names/implementation';
import { unbounded } from '../../apps/tagma/inspection/src/core/node/budget';
import type { NameParams } from '../../apps/tagma/inspection/src/packs/architecture/names/reading';
import { catalogPlugin, ruleName, type Options } from './catalogTags';
import { corpus, options } from './corpus';
import { parityPolicy } from './parityPolicy';

const repo = resolve(import.meta.dir, '../..');
const cli = join(repo, 'node_modules/oxlint/bin/oxlint');
const factory = pathToFileURL(join(import.meta.dir, 'catalogTags.ts')).href;
const namespace = 'runlith-catalog-tags';

type Evidence = { readonly fingerprint: string; readonly file: string; readonly lines: readonly number[]; readonly value: number };
type Site = { readonly code: string; readonly file: string; readonly line: number };
type JsonOutput = {
  readonly diagnostics: readonly {
    readonly code: string;
    readonly filename: string;
    readonly labels: readonly { readonly span: { readonly line: number } }[];
  }[];
  readonly number_of_files: number;
};
type SarifOutput = {
  readonly runs: readonly {
    readonly tool: { readonly driver: { readonly version: string } };
    readonly results: readonly {
      readonly ruleId: string;
      readonly locations: readonly {
        readonly physicalLocation: { readonly artifactLocation: { readonly uri: string }; readonly region: { readonly startLine: number } };
      }[];
    }[];
  }[];
};

const sorted = (findings: readonly Evidence[]): readonly Evidence[] =>
  [...findings].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
const parameters = (options: Options): NameParams => ({
  ...options,
  uncovered: options.uncovered.map((path) => ({ path, until: 'parity fixture' })),
  modules: [],
  services: ['Context.Service'],
  errors: ['Error'],
  glossary: [],
  checks: { literals: options.literals },
});

export const compare = (texts: Readonly<Record<string, string>>, options: Options, format: 'json' | 'sarif') => {
  const params = parameters(options);
  const paths = new Map(Object.keys(texts).map((path) => [path, path] as const));
  const held = blobTree(paths, new Map(Object.entries(texts)), new Map(), ADAPTERS, undefined, new Map());
  const read = new Set<string>();
  const tree: Tree = {
    ...held,
    facet: (path, facet) => {
      read.add(path);
      return facetOf(held, path, facet, ADAPTERS);
    },
  };
  const builtin = readNames(params, tree, Object.keys(texts), ADAPTERS, unbounded());
  assert.deepEqual(builtin.unjudged, []);
  const evidence = new Map<string, number[]>();
  for (const file of read) {
    const declarations = facetOf(held, file, OUTLINE, ADAPTERS);
    const local = file.slice(options.base === '' ? 0 : options.base.length + 1);
    for (const literal of declarations.literals) {
      const key = `literal ${local} '${literal.value}' ${literal.position}`;
      const lines = evidence.get(key);
      if (lines === undefined) evidence.set(key, [literal.line]);
      else lines.push(literal.line);
    }
  }
  const expected: Evidence[] = [];
  for (const finding of builtin.violations) {
    const lines = evidence.get(finding.fingerprint);
    assert(lines, `missing evidence ${finding.fingerprint}`);
    lines.sort((a, b) => a - b);
    assert.equal(lines.length, finding.value);
    assert(lines.includes(finding.line!));
    expected.push({ fingerprint: finding.fingerprint, file: finding.file, value: finding.value!, lines });
  }
  const pairs = new Map<string, { word: string; position: string }>(
    options.literals.flatMap((entry) =>
      entry.words.flatMap((word) =>
        entry.positions.map((position) => [`${namespace}(${ruleName(word, position)})`, { word, position }] as const),
      ),
    ),
  );
  const directory = mkdtempSync(join(tmpdir(), 'catalog-parity-'));
  try {
    for (const [path, text] of Object.entries(texts)) {
      assert(!isAbsolute(path) && !path.split('/').includes('..'));
      const target = join(directory, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    writeFileSync(
      join(directory, 'plugin.ts'),
      `import { catalogPlugin } from ${JSON.stringify(factory)};\nexport default catalogPlugin(${JSON.stringify(options)});\n`,
    );
    writeFileSync(
      join(directory, 'config.json'),
      JSON.stringify({
        plugins: [],
        categories: { correctness: 'off' },
        options: { respectEslintDisableDirectives: false },
        jsPlugins: ['./plugin.ts'],
        rules: Object.fromEntries(Object.keys(catalogPlugin(options).rules).map((name) => [`${namespace}/${name}`, 'error'])),
      }),
    );
    const result = spawnSync(
      process.execPath.includes('bun') ? 'node' : process.execPath,
      [cli, '--threads=1', '--disable-nested-config', '--no-ignore', '-c', 'config.json', `--format=${format}`, ...Object.keys(texts)],
      { cwd: directory, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, expected.length > 0 ? 1 : 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    const sites: Site[] = [];
    if (format === 'json') {
      const json = output as JsonOutput;
      assert.equal(json.number_of_files, Object.keys(texts).length);
      for (const diagnostic of json.diagnostics)
        sites.push({ code: diagnostic.code, file: diagnostic.filename, line: diagnostic.labels[0]!.span.line });
    } else {
      const sarif = output as SarifOutput;
      assert.equal(sarif.runs.length, 1);
      assert.equal(sarif.runs[0]!.tool.driver.version, '1.86.0');
      for (const result of sarif.runs[0]!.results) {
        assert.equal(result.locations.length, 1);
        const location = result.locations[0]!.physicalLocation;
        sites.push({ code: result.ruleId, file: location.artifactLocation.uri, line: location.region.startLine });
      }
    }
    const groups = new Map<string, { file: string; lines: number[] }>();
    for (const site of sites) {
      const pair = pairs.get(site.code);
      assert(pair, `unexpected checker rule: ${site.code}`);
      const file = (isAbsolute(site.file) ? relative(directory, site.file) : site.file).split(sep).join('/');
      assert(Object.hasOwn(texts, file), `unexpected checker file: ${file}`);
      const local = file.slice(options.base === '' ? 0 : options.base.length + 1);
      const key = `literal ${local} '${pair.word}' ${pair.position}`;
      const held = groups.get(key);
      if (held === undefined) groups.set(key, { file, lines: [site.line] });
      else held.lines.push(site.line);
    }
    const actual = sorted(
      [...groups].map(([fingerprint, { file, lines }]) => ({ fingerprint, file, value: lines.length, lines: lines.sort((a, b) => a - b) })),
    );
    assert.deepEqual(actual, sorted(expected));
    const digest = createHash('sha256');
    for (const path of Object.keys(texts).sort()) digest.update(JSON.stringify([path, texts[path]]));
    return {
      format,
      files: Object.keys(texts).length,
      units: actual.length,
      occurrences: sites.length,
      sha256: digest.digest('hex'),
      findings: actual,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const headSources = (head: string): Readonly<Record<string, string>> => {
  const paths = spawnSync('git', ['ls-tree', '-r', '--name-only', head, '--', `${parityPolicy.base}/graph`], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(paths.status, 0, paths.stderr);
  const params = parameters(parityPolicy);
  const selected = paths.stdout
    .trim()
    .split('\n')
    .filter((path) => names.selects(params, path));
  const blobs = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repo,
    input: selected.map((path) => `${head}:${path}\n`).join(''),
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(blobs.status, 0, blobs.stderr.toString());
  const texts: Record<string, string> = {};
  let at = 0;
  for (const path of selected) {
    const end = blobs.stdout.indexOf(10, at);
    const header = blobs.stdout.subarray(at, end).toString();
    const match = /^[\da-f]+ blob (\d+)$/.exec(header);
    assert(match, `unread blob ${path}: ${header}`);
    const size = Number(match[1]);
    at = end + 1;
    texts[path] = blobs.stdout.subarray(at, at + size).toString();
    at += size + 1;
  }
  assert.equal(at, blobs.stdout.length);
  return texts;
};

if (import.meta.main) {
  const revision = process.argv.find((arg) => arg.startsWith('--head='))?.slice('--head='.length);
  const head = spawnSync('git', ['rev-parse', '--verify', `${revision ?? 'HEAD'}^{commit}`], { cwd: repo, encoding: 'utf8' });
  assert.equal(head.status, 0, head.stderr);
  const snapshot = head.stdout.trim();
  const atHead = revision !== undefined || process.argv.includes('--head');
  const policy = atHead ? parityPolicy : options;
  const reading = compare(atHead ? headSources(snapshot) : corpus, policy, 'json');
  const version = JSON.parse(readFileSync(join(repo, 'node_modules/oxlint/package.json'), 'utf8')).version;
  const provenance = Object.fromEntries(
    [
      'checks/lint/catalogTags.ts',
      'checks/lint/parity.ts',
      'apps/tagma/inspection/src/packs/architecture/names/implementation.ts',
      'apps/tagma/inspection/src/packs/architecture/names/literals.ts',
      'apps/tagma/inspection/src/packs/architecture/names/reading.ts',
      'packages/code-facts/src/languages/js/declarations.ts',
      'packages/code-facts/src/languages/js/imports.ts',
    ].map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(join(repo, path)))
        .digest('hex'),
    ]),
  );
  console.log(
    JSON.stringify(
      {
        checker: `oxlint@${version}`,
        head: snapshot,
        policy: atHead ? 'parity-only; not adopted' : 'mutation corpus',
        parameters: policy,
        provenance,
        ...reading,
      },
      null,
      2,
    ),
  );
}
