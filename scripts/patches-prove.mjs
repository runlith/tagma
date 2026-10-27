// Proves every hunk of a dependency patch: its tests are red with that hunk taken out and green with the whole patch.
// A `@@` block belongs to the hunk whose marker its added lines carry; a block with no owner or two owners refuses the run.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const patchesDir = join(root, 'patches');
// `bun run patches:prove <hunk>` proves one hunk inside the thirty-second gate; no argument proves them all and the whole patch.
const checkInputs = process.argv[2] === '--check-inputs';
const only = checkInputs ? undefined : process.argv[2];

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function parsePatch(text) {
  const files = [];
  let file;
  let block;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { header: [line], blocks: [], path: line.split(' ')[2].replace(/^a\//, '') };
      block = undefined;
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (line.startsWith('@@')) {
      block = { lines: [line], owners: new Set() };
      file.blocks.push(block);
      continue;
    }
    if (block) block.lines.push(line);
    else file.header.push(line);
  }
  return files;
}

function classify(files, hunks) {
  const problems = [];
  for (const file of files) {
    file.blocks.forEach((block, index) => {
      for (const line of block.lines) {
        if (!line.startsWith('+')) continue;
        for (const [id, hunk] of Object.entries(hunks)) {
          if (hunk.markers.some((marker) => line.includes(marker))) block.owners.add(id);
        }
      }
      if (block.owners.size !== 1) {
        problems.push(`${file.path} block ${index + 1}: owners ${[...block.owners].join(', ') || 'none'}`);
      }
    });
  }
  return problems;
}

function render(files, without) {
  const out = [];
  for (const file of files) {
    const blocks = file.blocks.filter((block) => !block.owners.has(without));
    if (blocks.length === 0) continue;
    out.push(...file.header);
    for (const block of blocks) out.push(...block.lines);
  }
  return `${out.join('\n').replace(/\n*$/, '')}\n`;
}

// The package as the registry shipped it: bun keeps it in its cache beside the patched copies, and `bun install` repopulates it.
function pristineDir(pkg) {
  const cacheResult = run('bun', ['pm', 'cache'], root);
  if (cacheResult.status !== 0) throw new Error(`bun pm cache failed:\n${cacheResult.out}`);
  const cache = cacheResult.out.trim();
  const separator = pkg.lastIndexOf('@');
  if (separator <= 0) throw new Error(`expected an exact package@version, received ${pkg}`);
  const name = pkg.slice(0, separator);
  const version = pkg.slice(separator + 1);
  const matches = (dir) => {
    const path = join(dir, 'package.json');
    if (!existsSync(path)) return false;
    const metadata = JSON.parse(readFileSync(path, 'utf8'));
    return metadata.name === name && metadata.version === version;
  };
  const exact = join(cache, `${pkg}@@@1`);
  if (existsSync(exact)) {
    if (!matches(exact)) throw new Error(`${exact} does not identify ${pkg}`);
    return exact;
  }
  // Bun hashes prerelease cache names; the cached package's identity, not that hash, selects the bytes.
  const scope = join(cache, dirname(name));
  const candidates = existsSync(scope)
    ? readdirSync(scope)
        .filter((entry) => entry.startsWith(`${basename(name)}@`) && entry.endsWith('@@@1'))
        .map((entry) => join(scope, entry))
        .filter(matches)
    : [];
  if (candidates.length !== 1) {
    throw new Error(
      `expected one pristine cache entry for ${pkg}, found ${candidates.length}: ${candidates.join(', ')}; bun install repopulates the cache`,
    );
  }
  return candidates[0];
}

function installedDir(name, testPackage) {
  return realpathSync(join(root, testPackage, 'node_modules', name));
}

function trialDir(scratch, id, name, installed) {
  const dir = join(scratch, id);
  mkdirSync(dir, { recursive: true });
  symlinkSync(installed.slice(0, installed.length - name.length - 1), join(dir, 'node_modules'));
  return join(dir, 'package');
}

function apply(pristine, patchText, work) {
  rmSync(work, { recursive: true, force: true });
  cpSync(pristine, work, { recursive: true });
  // A patch cut down to nothing IS the pristine package: a minified bundle carries every change in one
  // diff block, so its manifest names one hunk and taking that hunk out leaves the registry's own bytes.
  if (patchText.trim() === '') return;
  const patchPath = `${work}.patch`;
  writeFileSync(patchPath, patchText);
  const result = run('patch', ['-p1', '-s', '--no-backup-if-mismatch', '-d', work, '-i', patchPath], root);
  if (result.status !== 0) throw new Error(`patch failed:\n${result.out}`);
}

const BUN_REDIRECT = `
const { installed, work } = JSON.parse(process.env.PATCHES_PROVE_TRIAL);
const escaped = installed.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
const served = async (path) => {
  const file = work + path.slice(installed.length);
  const module = await import(file);
  const target = JSON.stringify(file);
  return 'export * from ' + target + ';' + ('default' in module ? 'export { default } from ' + target + ';' : '');
};
const entries = new Map();
Bun.plugin({
  name: 'patches-prove',
  setup(build) {
    build.onLoad({ filter: new RegExp('^' + escaped + '/') }, async (args) => {
      if (!entries.has(args.path)) entries.set(args.path, await served(args.path));
      return { contents: entries.get(args.path), loader: 'js' };
    });
  },
});
`;

const vitestConfig = (base, trial) => `
import { readFileSync } from 'node:fs';
import base from ${JSON.stringify(base)};
const trial = ${JSON.stringify(trial)};
const redirect = {
  name: 'patches-prove',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0];
    return file.startsWith(trial.installed + '/') ? readFileSync(trial.work + file.slice(trial.installed.length), 'utf8') : undefined;
  },
};
const deps = base.test?.server?.deps ?? {};
export default {
  ...base,
  plugins: [redirect, ...(base.plugins ?? [])],
  test: {
    ...base.test,
    experimental: { ...base.test?.experimental, fsModuleCache: false },
    server: { ...base.test?.server, deps: { ...deps, inline: [...(deps.inline ?? []), trial.name] } },
  },
};
`;

const TEST_MS = 60_000;

function runnerOf(testPackage) {
  const script = JSON.parse(readFileSync(join(root, testPackage, 'package.json'), 'utf8')).scripts?.test ?? '';
  if (!/\bvitest\b/.test(script)) return { kind: 'bun' };
  const base = ['vitest.config.ts', 'vitest.config.mjs', 'vitest.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.js']
    .map((file) => join(root, testPackage, file))
    .find(existsSync);
  if (base === undefined) throw new Error(`${testPackage}: its test script runs vitest and no vite config stands beside it`);
  return { kind: 'vitest', base, bun: /--bun\s+vitest/.test(script) };
}

function trialRun(test, trial, scratch) {
  const cwd = join(root, test.package);
  const runner = runnerOf(test.package);
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', PATCHES_PROVE_TRIAL: JSON.stringify(trial) };
  if (runner.kind === 'bun') {
    const preload = join(scratch, 'redirect.mjs');
    writeFileSync(preload, BUN_REDIRECT);
    const args = [
      'test',
      test.file.startsWith('.') ? test.file : `./${test.file}`,
      '--preload',
      preload,
      ...(test.names ? ['-t', test.names] : []),
    ];
    return { runner, ...runIn('bun', args, cwd, env) };
  }
  const configDir = join(cwd, 'node_modules', `.patches-prove-${basename(scratch)}`);
  mkdirSync(configDir, { recursive: true });
  const config = join(configDir, 'vite.config.mjs');
  writeFileSync(config, vitestConfig(runner.base, trial));
  try {
    const args = [
      'run',
      ...(runner.bun ? ['--bun'] : []),
      'vitest',
      'run',
      test.file,
      '--config',
      config,
      ...(test.names ? ['-t', test.names] : []),
    ];
    return { runner, ...runIn('bun', args, cwd, env) };
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
}

function runIn(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'pipe', encoding: 'utf8', timeout: TEST_MS });
  return { status: result.status ?? 1, timedOut: result.error?.code === 'ETIMEDOUT', out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function verdictOf(result) {
  const lines = result.out.split('\n');
  if (result.timedOut) return `timed out after ${TEST_MS / 1000}s`;
  if (result.runner.kind === 'bun') {
    const failed = lines.filter((line) => line.startsWith('(fail) ')).map((line) => line.slice(7).replace(/ \[[\d.]+m?s\]$/, ''));
    const tally = ['pass', 'fail', 'error']
      .map((word) => lines.find((line) => new RegExp(`^\\s*\\d+ ${word}$`).test(line))?.trim())
      .filter(Boolean);
    if (failed.length > 0) return `tests failed (${tally.join(', ')}): ${[...new Set(failed)].join('; ')}`;
    const error = lines.find((line) => /^\w*Error\b|^error:/.test(line.trim()));
    if (result.status !== 0)
      return `the runner failed before a test failed (${tally.join(', ') || 'no tally'}): ${error?.trim() ?? lines.filter(Boolean).at(-1)}`;
    return tally.join(', ');
  }
  const tally = lines.find((line) => /^\s*Tests\s/.test(line))?.trim();
  const crossed = lines.filter((line) => /^\s*×\s/.test(line));
  const failed = (crossed.length > 0 ? crossed : lines.filter((line) => /^\s*FAIL\s/.test(line))).map((line) => line.trim());
  if (failed.length > 0) return `tests failed (${tally ?? 'no tally'}): ${[...new Set(failed)].join('; ')}`;
  const error = lines.find((line) => /\b\w*Error\b/.test(line));
  if (result.status !== 0)
    return `the runner failed before a test failed (${tally ?? 'no tally'}): ${(error ?? lines.filter(Boolean).at(-1))?.trim()}`;
  return tally ?? lines.filter(Boolean).at(-1)?.trim();
}

function runTests(tests, trial, scratch) {
  let status = 0;
  const summaries = [];
  for (const test of tests) {
    const result = trialRun(test, trial, scratch);
    if (result.status !== 0) status = 1;
    summaries.push(`${test.package} ${test.file}${test.names ? ` -t ${test.names}` : ''}: ${verdictOf(result)}`);
  }
  return { status, summaries };
}

let failed = false;
let selected = false;

for (const manifestName of readdirSync(patchesDir).filter((name) => name.endsWith('.hunks.json'))) {
  const manifest = JSON.parse(readFileSync(join(patchesDir, manifestName), 'utf8'));
  if (only !== undefined && !(only in manifest.hunks)) continue;
  selected = true;
  const patchText = readFileSync(join(patchesDir, manifestName.replace(/\.hunks\.json$/, '.patch')), 'utf8');
  const files = parsePatch(patchText);
  const problems = classify(files, manifest.hunks);
  if (problems.length > 0) {
    console.error(`${manifest.package}: every diff block must belong to exactly one hunk\n  ${problems.join('\n  ')}`);
    failed = true;
    continue;
  }
  // A hunk with only an e2e trap is proven where that spec runs; here it is named, not run.
  const untested = Object.entries(manifest.hunks)
    .filter(([, hunk]) => !hunk.tests?.length && !hunk.e2e?.length)
    .map(([id]) => id);
  if (untested.length > 0) {
    console.error(`${manifest.package}: hunks without tests: ${untested.join(', ')}`);
    failed = true;
    continue;
  }
  const name = manifest.package.replace(/@[^@]+$/, '');
  const testPackage = Object.values(manifest.hunks).find((hunk) => hunk.tests?.length)?.tests[0].package;
  const installed = installedDir(name, testPackage);
  const pristine = pristineDir(manifest.package);
  if (checkInputs) {
    console.log(`${manifest.package}: inputs valid; pristine=${pristine}; installed=${installed}`);
    continue;
  }
  const scratch = mkdtempSync(join(tmpdir(), 'patches-prove-'));
  const full = trialDir(scratch, 'full', name, installed);
  apply(pristine, patchText, full);

  try {
    for (const [id, hunk] of Object.entries(manifest.hunks)) {
      if (only !== undefined && id !== only) continue;
      if (!hunk.tests?.length) {
        const traps = hunk.e2e.map((trap) => `${trap.app} ${trap.spec} -g "${trap.names}"`).join('; ');
        console.log(`${manifest.package} ${id}: proven by e2e elsewhere only\n  ${traps}`);
        continue;
      }
      const work = trialDir(scratch, `without-${id}`, name, installed);
      apply(pristine, render(files, id), work);
      const { status, summaries } = runTests(hunk.tests, { name, installed, work }, scratch);
      const verdict = status === 0 ? 'NOT PROVEN: green without it' : 'proven: red without it';
      console.log(`${manifest.package} ${id}: ${verdict}\n  ${summaries.join('\n  ')}`);
      if (status === 0) failed = true;
    }
    {
      const allTests = Object.entries(manifest.hunks).flatMap(([id, hunk]) =>
        only === undefined || id === only ? (hunk.tests ?? []) : [],
      );
      const { status, summaries } = runTests(allTests, { name, installed, work: full }, scratch);
      console.log(`${manifest.package} whole patch: ${status === 0 ? 'green' : 'RED'}\n  ${summaries.join('\n  ')}`);
      if (status !== 0) failed = true;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (only !== undefined && !selected) {
  console.error(`no hunk named ${only}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
