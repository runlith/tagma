import type { ShellWord } from './shellCommands';

type Starter = {
  readonly sub?: readonly (string | null)[];
  readonly needs?: readonly string[];
  readonly unless?: readonly string[];
  readonly implicit?: readonly string[];
};

const SNAPSHOTS = ['__snapshots__/', '*.snap', 'coverage/', '.nyc_output/'];
const TSBUILD = ['*.tsbuildinfo'];
const PYTEST = ['__snapshots__/', '*.ambr', '.pytest_cache/', '.coverage', 'htmlcov/', 'coverage.xml'];
const CARGO = ['Cargo.lock', '*.snap.new', '*.pending-snap'];
const SWIFT = ['Package.resolved', '__Snapshots__/'];

const EXCEPTIONS = [
  '-u',
  '--update-snapshots',
  '--updateSnapshot',
  '--update',
  '-update',
  '--test-update-snapshots',
  '--fix',
  '--write',
  '-w',
  '--emit',
  '--autocorrect',
  '--auto-correct',
  '--autocorrect-all',
];

const OUTPUTS: Readonly<Record<string, readonly string[]>> = {
  jest: ['--outputFile', '--coverageDirectory'],
  vitest: ['--outputFile', '--coverage.reportsDirectory'],
  bun: ['--reporter-outfile', '--coverage-dir'],
  pytest: ['--junitxml', '--junit-xml', '--html', '--json-report-file', '--cov-report'],
  eslint: ['-o', '--output-file', '--cache-location'],
  go: ['-o', '-coverprofile', '-cpuprofile', '-memprofile', '-blockprofile', '-mutexprofile', '-trace', '-outputdir'],
  xcodebuild: ['-derivedDataPath', '-resultBundlePath'],
  playwright: ['--output'],
  curl: ['-o', '--output'],
};

export const outputFlagsOf = (name: string): readonly string[] => OUTPUTS[name] ?? [];
const OUTPUT_ENV = /^[A-Za-z0-9_]*_(?:REPORT|OUTPUT)=/;
const CHECK_SCRIPTS = new Set(['test', 'tests', 'typecheck', 'type-check', 'check-types', 'types', 'tsc', 'lint', 'check']);
const PACKAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

const STARTERS: Readonly<Record<string, readonly Starter[]>> = {
  bun: [
    { sub: ['test'], implicit: SNAPSHOTS },
    { sub: ['check'], implicit: TSBUILD },
  ],
  vitest: [{ sub: [null, 'run', 'related', 'bench'], implicit: SNAPSHOTS }],
  jest: [{ implicit: SNAPSHOTS }],
  mocha: [{ implicit: SNAPSHOTS }],
  ava: [{ implicit: SNAPSHOTS }],
  tap: [{ implicit: SNAPSHOTS }],
  jasmine: [{}],
  uvu: [{}],
  karma: [{ sub: ['start', 'run'] }],
  playwright: [{ sub: ['test'], implicit: ['test-results/', 'playwright-report/', '*-snapshots/'] }],
  cypress: [{ sub: ['run'], implicit: ['cypress/screenshots/', 'cypress/videos/'] }],
  node: [{ needs: ['--test'], implicit: SNAPSHOTS }],
  deno: [{ sub: ['test'], implicit: SNAPSHOTS }, { sub: ['check'] }, { sub: ['lint'] }, { sub: ['fmt'], needs: ['--check'] }],
  tsc: [{ needs: ['--noEmit', '-noEmit'], implicit: TSBUILD }],
  'vue-tsc': [{ needs: ['--noEmit'], implicit: TSBUILD }],
  'svelte-check': [{}],
  astro: [{ sub: ['check'] }],
  flow: [{ sub: [null, 'check', 'status'] }],
  eslint: [{ implicit: ['.eslintcache'] }],
  oxlint: [{}],
  biome: [{ sub: ['check', 'lint', 'ci'], unless: ['--apply', '--apply-unsafe'] }],
  prettier: [{ needs: ['--check', '-c', '--list-different', '-l'] }],
  oxfmt: [{ needs: ['--check', '--list-different'] }],
  stylelint: [{ implicit: ['.stylelintcache'] }],
  standard: [{}],
  xo: [{}],
  knip: [{}],
  dprint: [{ sub: ['check'] }],
  markdownlint: [{}],
  'markdownlint-cli2': [{}],
  cspell: [{}],
  pytest: [{ implicit: PYTEST }],
  'py.test': [{ implicit: PYTEST }],
  unittest: [{}],
  nose2: [{}],
  mypy: [{ implicit: ['.mypy_cache/'] }],
  dmypy: [{ sub: ['run', 'check', 'status'], implicit: ['.mypy_cache/', '.dmypy.json'] }],
  pyright: [{}],
  basedpyright: [{}],
  pyre: [{ sub: ['check'], implicit: ['.pyre/'] }],
  pytype: [{ implicit: ['.pytype/'] }],
  ruff: [
    { sub: ['check'], implicit: ['.ruff_cache/'] },
    { sub: ['format'], needs: ['--check', '--diff'], implicit: ['.ruff_cache/'] },
  ],
  flake8: [{}],
  pylint: [{}],
  black: [{ needs: ['--check', '--diff'] }],
  isort: [{ needs: ['--check', '--check-only', '-c', '--diff'] }],
  bandit: [{}],
  pycodestyle: [{}],
  pydocstyle: [{}],
  pyflakes: [{}],
  vulture: [{}],
  go: [{ sub: ['test', 'vet'], implicit: ['go.sum'] }],
  'golangci-lint': [{ sub: ['run'] }],
  staticcheck: [{}],
  gofmt: [{ needs: ['-l', '-d'] }],
  govulncheck: [{}],
  cargo: [
    { sub: ['test', 'check', 'clippy', 'nextest', 'deny', 'audit', 'machete'], implicit: CARGO },
    { sub: ['fmt'], needs: ['--check'] },
  ],
  swift: [{ sub: ['test'], implicit: SWIFT }],
  swiftlint: [{ sub: [null, 'lint'], unless: ['--autocorrect'] }],
  'swift-format': [{ sub: ['lint'] }],
  xcodebuild: [{ sub: ['test'] }],
  gradle: [{ sub: ['test', 'check'] }],
  mvn: [{ sub: ['test', 'verify'] }],
  ktlint: [{ unless: ['-F', '--format'] }],
  detekt: [{}],
  rspec: [{}],
  rubocop: [{ unless: ['-a', '-A', '-x', '--fix-layout'] }],
  rake: [{ sub: ['test', 'spec'] }],
  phpunit: [{}],
  pest: [{}],
  phpstan: [{ sub: ['analyse', 'analyze'] }],
  psalm: [{ unless: ['--alter'] }],
  phpcs: [{}],
  'php-cs-fixer': [{ needs: ['--dry-run'] }],
  dotnet: [{ sub: ['test'] }, { sub: ['format'], needs: ['--verify-no-changes'] }],
  mix: [{ sub: ['test', 'credo', 'dialyzer'] }, { sub: ['format'], needs: ['--check-formatted'] }],
  ctest: [{}],
  'clang-tidy': [{ unless: ['-fix', '-fix-errors', '--fix', '--fix-errors'] }],
  cppcheck: [{}],
  shellcheck: [{}],
  hadolint: [{}],
  actionlint: [{}],
  tflint: [{}],
  terraform: [{ sub: ['validate'] }, { sub: ['fmt'], needs: ['-check'] }],
  xcrun: [{ sub: ['notarytool'] }],
  curl: [{ unless: ['-O', '--remote-name', '--remote-name-all', '-J', '--remote-header-name'] }],
};

export type Listing = { readonly listed: boolean; readonly flagged: boolean; readonly implicit: readonly string[] };

const NOT_LISTED: Listing = { listed: false, flagged: false, implicit: [] };

const FLAGGED: Listing = { listed: false, flagged: true, implicit: [] };

const firstWord = (words: readonly ShellWord[]): string | null => {
  for (const word of words) {
    if (!word.literal) return null;
    if (word.text.startsWith('-')) continue;
    return word.text;
  }
  return null;
};

const flagged = (texts: readonly string[], flags: readonly string[]): boolean =>
  texts.some((text) => flags.some((flag) => text === flag || (flag.startsWith('--') && text.startsWith(`${flag}=`))));

function packagerListing(name: string, args: readonly ShellWord[], texts: readonly string[], env: readonly string[]): Listing | null {
  if (!PACKAGERS.has(name)) return null;
  const sub = firstWord(args);
  if (sub === null) return NOT_LISTED;
  const script = sub === 'run' || sub === 'run-script' ? firstWord(args.slice(args.findIndex((word) => word.text === sub) + 1)) : sub;
  if (name === 'bun' && sub !== 'run') return null;
  if (script === null || (sub !== 'run' && sub !== 'run-script' && sub !== 'test' && sub !== 't' && name !== 'yarn')) return NOT_LISTED;
  const last = (sub === 't' ? 'test' : script).split(':').pop() ?? '';
  if (!CHECK_SCRIPTS.has(last)) {
    const at = args.findIndex((word) => word.text === script);
    return STARTERS[script] === undefined || at === -1 ? NOT_LISTED : listingOf(script, args.slice(at), env);
  }
  if (flagged(texts, EXCEPTIONS) || env.some((text) => OUTPUT_ENV.test(text))) return FLAGGED;
  return {
    listed: true,
    flagged: false,
    implicit: last === 'test' || last === 'tests' ? SNAPSHOTS : last === 'check' || last.includes('type') || last === 'tsc' ? TSBUILD : [],
  };
}

export const plainProgram = (name: string): boolean => STARTERS[name]?.every((starter) => starter.sub === undefined) === true;

export function listingOf(name: string, words: readonly ShellWord[], env: readonly string[]): Listing {
  const args = words.slice(1);
  const texts = words.map((word) => word.text);
  const packaged = packagerListing(name, args, texts, env);
  if (packaged !== null) return packaged;
  const starters = STARTERS[name];
  if (starters === undefined) return NOT_LISTED;
  const sub = firstWord(args);
  let matched = false;
  for (const starter of starters) {
    if (starter.sub !== undefined && !starter.sub.includes(sub) && !(starter.sub.includes(null) && sub !== null && /[./]/.test(sub)))
      continue;
    matched = true;
    if (starter.needs !== undefined && !flagged(texts, starter.needs)) continue;
    if (flagged(texts, [...EXCEPTIONS, ...(starter.unless ?? [])]) || env.some((text) => OUTPUT_ENV.test(text))) return FLAGGED;
    return { listed: true, flagged: false, implicit: starter.implicit ?? [] };
  }
  return matched ? FLAGGED : NOT_LISTED;
}
