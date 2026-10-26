import { dirname, posix } from 'node:path';
import { Effect, FileSystem, Schema, Semaphore } from 'effect';
import { Git } from '@runlith/git/Git';
import { type ProgramEnding, ProgramRoad } from '../executions/contract/service/programs.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { type ConfigVersion, Configs } from './contract/service/configs.js';
import { CONFIG_FILE } from './contract/wire/config.js';
import { configOf, type Misfit } from './decode.js';
import { EVALUATOR, evaluationProfile, type Profile } from './profile.js';
import { Answer, type Job, type Place } from './protocol.js';
import { baseOf, candidatesOf, isRelative, keyLine } from './sources.js';
import { type Entry, keptEntry, type Outcome, storedEntries, storeFile, storeFileIn } from './store.js';
import { blobsAt, carriedAt, type Found, filesAt } from './version.js';

const TAIL = 1_500;

const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(Answer));

const SCANNED: Readonly<Record<string, 'ts' | 'tsx' | 'js' | 'jsx'>> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
};

const scanners = new Map<string, Bun.Transpiler>();

const scannerFor = (path: string): Bun.Transpiler | null => {
  const loader = SCANNED[posix.extname(path)];
  if (loader === undefined) return null;
  const held = scanners.get(loader) ?? new Bun.Transpiler({ loader });
  scanners.set(loader, held);
  return held;
};

const foreseen = (path: string, text: string): readonly string[] => {
  const scanner = scannerFor(path);
  if (scanner === null) return [];
  let specifiers: readonly string[];
  try {
    specifiers = scanner.scanImports(text).map((one) => one.path);
  } catch {
    specifiers = [];
  }
  return specifiers.flatMap((specifier) => {
    const base = isRelative(specifier) ? baseOf(path, specifier) : null;
    return base === null ? [] : candidatesOf(base);
  });
};

const invalid = (place: Place): GateRefusal<'config-invalid'> => {
  const where = place.line === null ? place.file : `${place.file}:${place.line}`;
  return new GateRefusal('config-invalid', `${where}: ${place.reason}`, [
    `correct ${where} and land the fix: the config builds from relative files of the judged version and @runlith/tagma/* alone and evaluates to plain data, without the clock, randomness, the network, the environment or the file system`,
  ]);
};

const unran = (reason: string, unblock: string): GateRefusal<'config-invalid'> =>
  new GateRefusal('config-invalid', `${CONFIG_FILE} could not be evaluated: ${reason}`, [unblock]);

const tailOf = (text: string): string => {
  const trimmed = text.trim();
  return trimmed === '' ? 'nothing on stderr' : trimmed.length > TAIL ? `…${trimmed.slice(-TAIL)}` : trimmed;
};

const endedBy = (ending: ProgramEnding): GateRefusal<'config-invalid'> | string => {
  if (ending._tag === 'Unrun')
    return unran(`its evaluation did not start: ${ending.said}`, 'read what the host said and run the act again');
  if (ending._tag === 'Stopped') {
    return ending.late
      ? unran('its evaluation ran past the life the command rules give the `config` tool', `make ${CONFIG_FILE} finish: it must not loop`)
      : unran(`its evaluation was stopped before it finished: ${ending.said}`, 'run the act again');
  }
  if (ending.exitCode !== 0 || ending.cut) {
    return unran(
      `its evaluation exited ${ending.exitCode}${ending.cut ? ' with an answer too long to read' : ''}: ${tailOf(ending.stderr)}`,
      'run the act again',
    );
  }
  return ending.stdout;
};

export const makeConfigs = Effect.gen(function* () {
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const road = yield* ProgramRoad;
  const profileOnce = yield* Effect.cached(Effect.provideService(evaluationProfile(), FileSystem.FileSystem, files));
  const keeping = yield* Semaphore.make(1);

  const evaluation = Effect.fn('Configs.evaluate')(function* (version: ConfigVersion, job: Job) {
    const ending = yield* road.run({
      projectId: version.projectId,
      actor: version.actor,
      argv: ['/usr/bin/env', '-i', 'TZ=UTC', process.execPath, '--config=/dev/null', '--no-env-file', '--no-install', EVALUATOR],
      cwd: dirname(EVALUATOR),
      policyRoot: version.root,
      stdin: JSON.stringify(job),
      tool: 'config',
      operation: `config:${crypto.randomUUID()}`,
      subject: CONFIG_FILE,
    });
    const said = endedBy(ending);
    if (typeof said !== 'string') return yield* said;
    return yield* decodeAnswer(said.trim().split('\n').at(-1) ?? '').pipe(
      Effect.mapError(() => unran(`its evaluation answered no readable result: ${tailOf(said)}`, 'run the act again')),
    );
  });

  const evaluated = Effect.fnUntraced(function* (version: ConfigVersion, config: Found, seed: readonly string[], profile: Profile) {
    const known: Record<string, string> = { [CONFIG_FILE]: config.text };
    const blobs = new Map<string, string>([[CONFIG_FILE, config.blob]]);
    const absent = new Set<string>();
    const read = Effect.fnUntraced(function* (paths: readonly string[]) {
      const asked = [...new Set(paths)].filter((path) => known[path] === undefined && !absent.has(path));
      if (asked.length === 0) return [];
      for (const [path, file] of yield* filesAt(git, version.root, version.tree, asked)) {
        if (file === null) absent.add(path);
        else {
          known[path] = file.text;
          blobs.set(path, file.blob);
        }
      }
      return asked;
    });
    const foresee = Effect.fnUntraced(function* (from: readonly string[]) {
      let frontier = from;
      while (frontier.length > 0) {
        const asked = yield* read(frontier.flatMap((path) => (known[path] === undefined ? [] : foreseen(path, known[path]))));
        frontier = asked.filter((path) => known[path] !== undefined);
      }
    });
    yield* read(seed);
    yield* foresee(Object.keys(known));
    for (;;) {
      const answer = yield* evaluation(version, { entry: CONFIG_FILE, files: known, absent: [...absent], doors: profile.doors });
      if (answer._tag === 'wanted') {
        const asked = yield* read(answer.paths);
        if (asked.length === 0) {
          return yield* unran(`its evaluation asked again for ${answer.paths.join(', ')}, which it was given`, 'run the act again');
        }
        yield* foresee(asked);
        continue;
      }
      const outcome: Outcome =
        answer._tag === 'evaluated'
          ? { _tag: 'evaluated', value: answer.value }
          : { _tag: 'refused', file: answer.file, line: answer.line, reason: answer.reason };
      const loaded = Object.fromEntries(answer.loaded.flatMap((path) => (blobs.has(path) ? [[path, blobs.get(path)!]] : [])));
      return {
        profile: profile.revision,
        loaded: { ...loaded, [CONFIG_FILE]: config.blob },
        missed: answer.missed,
        outcome,
      } satisfies Entry;
    }
  });

  const standing = Effect.fn('Configs.standing')(function* (
    version: ConfigVersion,
    entries: readonly Entry[],
    config: Found,
    profile: Profile,
  ) {
    const candidates = entries.filter((entry) => entry.profile === profile.revision && entry.loaded[CONFIG_FILE] === config.blob);
    if (candidates.length === 0) return null;
    const paths = [...new Set(candidates.flatMap((entry) => [...Object.keys(entry.loaded), ...entry.missed]))];
    const now = yield* blobsAt(git, version.root, version.tree, paths);
    return (
      candidates.find(
        (entry) =>
          Object.entries(entry.loaded).every(([path, blob]) => now.get(path) === blob) &&
          entry.missed.every((path) => now.get(path) === null),
      ) ?? null
    );
  });

  const placed = Effect.fnUntraced(function* (version: ConfigVersion, entry: Entry, config: Found, misfit: Misfit) {
    const key = misfit.key;
    if (key === null) return { file: CONFIG_FILE, line: null, reason: misfit.reason };
    const inRoot = keyLine(config.text, key);
    if (inRoot !== null) return { file: CONFIG_FILE, line: inRoot, reason: misfit.reason };
    const others = Object.keys(entry.loaded)
      .filter((path) => path !== CONFIG_FILE)
      .sort();
    for (const [path, file] of yield* filesAt(git, version.root, version.tree, others)) {
      const line = file === null ? null : keyLine(file.text, key);
      if (line !== null) return { file: path, line, reason: misfit.reason };
    }
    return { file: CONFIG_FILE, line: null, reason: misfit.reason };
  });

  return Configs.of({
    read: Effect.fn('Configs.read')(function* (version) {
      const config = (yield* filesAt(git, version.root, version.tree, [CONFIG_FILE])).get(CONFIG_FILE) ?? null;
      if (config === null) return null;
      const profile = yield* profileOnce;
      const file = version.commonDir === undefined ? yield* storeFile(git, version.root) : storeFileIn(version.commonDir);
      const entries = yield* Effect.provideService(storedEntries(file), FileSystem.FileSystem, files);
      let entry = yield* standing(version, entries, config, profile);
      if (entry === null) {
        const seed = entries[0] === undefined ? [] : [...Object.keys(entries[0].loaded), ...entries[0].missed];
        const fresh = yield* evaluated(version, config, seed, profile);
        yield* keeping.withPermits(1)(Effect.provideService(keptEntry(file, fresh), FileSystem.FileSystem, files));
        entry = fresh;
      }
      if (entry.outcome._tag === 'refused') return yield* invalid(entry.outcome);
      const decoded = configOf(entry.outcome.value, [...Object.keys(entry.loaded), ...entry.missed]);
      if (decoded._tag === 'Failure') return yield* invalid(yield* placed(version, entry, config, decoded.failure));
      return decoded.success;
    }),
    carried: ({ root, commits }) => carriedAt(git, root, commits),
  });
});
