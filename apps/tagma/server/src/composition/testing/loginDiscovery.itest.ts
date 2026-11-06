import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { claudeCode } from '@runlith/adapter-anthropic/harness';
import { codex } from '@runlith/adapter-openai/harness';
import type { CliHarnessProvider, HarnessProvider } from '@runlith/tagma/adapter/provider';
import { existsSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { Context, Effect, Fiber, FileSystem, Layer, Stream } from 'effect';
import { HostManagement } from '../../executions/contract/service/host.js';
import { TerminalEndings } from '../../executions/contract/service/endings.js';
import { Terminals, TerminalRequests } from '../../executions/contract/service/terminals.js';
import { makeHarnessAdapters } from '../../external-harnesses/adapters.js';
import { accountCliLayer } from '../../external-harnesses/accounts/cli.js';
import { makeInstalledHarnesses } from '../../external-harnesses/birth/installed.js';
import { HarnessAdapters } from '../../external-harnesses/contract/service/adapters.js';
import { UserEnvironment, type ProfileAnswer } from '../../installation/contract/service/userEnvironment.js';
import { makeUserEnvironment } from '../../installation/process/userEnvironment.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { FileWatcher, WatchRefused } from '../../platform/contract/service/watch.js';
import { DefaultLogins, defaultLoginsLayer, type DefaultLoginBook } from '../../providers/accounts/defaultLogins.js';
import { HarnessDirectories, makeHarnessDirectoryStore, type HarnessDirectoryStore } from '../../providers/accounts/harnessRows.js';
import { AccountCli, LoginPlaces } from '../../providers/contract/service/cli.js';
import { BuiltinAdapters, ProviderRegistry } from '../../providers/contract/service/registry.js';
import type { DirectoryAccount } from '../../providers/contract/wire/harnessAccounts.js';
import { registryLayer } from '../../providers/registry.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { watchProcessLayer } from './fileWatcher.js';

const unused = () => Effect.die('passive discovery does not open a terminal');
const terminals = Terminals.of({
  start: unused,
  target: unused,
  record: unused,
  recordsOf: unused,
  shell: unused,
  state: unused,
  wait: unused,
  signal: unused,
  stop: unused,
  stopAsked: unused,
  lost: unused,
  inventory: unused,
});
const host = HostManagement.of({
  standing: unused(),
  get connection(): never {
    throw new Error('passive discovery does not connect to the terminal host');
  },
  successor: unused(),
});
const endings = TerminalEndings.of({ decided: unused, watch: unused, resume: unused, attend: unused });
const requests = TerminalRequests.of({ request: unused, requestFor: unused, retention: unused });
const projects = Projects.of({
  list: unused,
  byId: unused,
  named: unused,
  resolve: unused,
  global: unused,
  removed: unused,
  register: unused,
  setRoot: unused,
  rename: unused,
  remove: unused,
  forget: unused,
  registryVersion: unused(),
});

const withDefault = (provider: HarnessProvider, directory: string): CliHarnessProvider => {
  if (provider.auth !== 'cli' || provider.accounts?.discovery === undefined) throw new Error('fixture requires a discovering CLI');
  return { ...provider, accounts: { ...provider.accounts, discovery: { ...provider.accounts.discovery, directory } } };
};

const executable = (root: string, defaults: { readonly claude: string; readonly codex: string }) => `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(root)};
const defaults = ${JSON.stringify(defaults)};
const program = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const variable = program === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
const directory = process.env[variable] ?? null;
fs.appendFileSync(path.join(root, 'runs.jsonl'), JSON.stringify({ program, args, directory, cwd: process.cwd() }) + '\\n');
if (args[0] === '--version') { console.log('fixture 1.0.0'); process.exit(0); }
const place = directory ?? defaults[program];
const file = program === 'claude' ? '.claude.json' : 'auth.json';
const state = JSON.parse(fs.readFileSync(path.join(place, file), 'utf8'));
if (fs.existsSync(path.join(root, 'hold-' + program))) {
  fs.writeFileSync(path.join(root, 'started-' + program), 'started');
  await new Promise((done) => {
    const released = path.join(root, 'release-' + program);
    const listener = fs.watch(root, () => { if (fs.existsSync(released)) { listener.close(); done(); } });
    if (fs.existsSync(released)) { listener.close(); done(); }
  });
  fs.writeFileSync(path.join(root, 'finished-' + program), 'finished');
}
if (program === 'claude') {
  console.log(JSON.stringify(state));
  process.exit(state.loggedIn ? 0 : 1);
}
console.error(state.signed ? 'Logged in using ChatGPT' : 'Not logged in');
process.exit(state.signed ? 0 : 1);
`;

type Start = { readonly program: string; readonly args: readonly string[]; readonly directory: string | null; readonly cwd: string };

const starts = (files: FileSystem.FileSystem, root: string) =>
  Effect.map(files.readFileString(join(root, 'runs.jsonl')), (text): readonly Start[] =>
    text.trim() === ''
      ? []
      : text
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Start),
  );

const replaceLogin = Effect.fnUntraced(function* (files: FileSystem.FileSystem, path: string, state: object) {
  const staged = `${path}.fixture`;
  yield* files.writeFileString(staged, JSON.stringify(state));
  yield* files.rename(staged, path);
});

const whenExists = (path: string) =>
  Effect.callback<void>((resume) => {
    const finish = () => {
      if (existsSync(path)) {
        listener.close();
        resume(Effect.void);
      }
    };
    const listener = watch(dirname(path), finish);
    finish();
    return Effect.sync(() => listener.close());
  });

const whenRow = (
  book: DefaultLoginBook,
  rows: HarnessDirectoryStore,
  provider: string,
  matches: (row: DirectoryAccount | undefined) => boolean,
) =>
  Stream.runHead(
    book.changes.pipe(
      Stream.filter((changed) => changed === provider),
      Stream.mapEffect(() => rows.of(provider)),
      Stream.filter((held) => held.some(matches)),
    ),
  );

const makeRig = Effect.fnUntraced(function* (input: {
  readonly root: string;
  readonly providers: readonly CliHarnessProvider[];
  readonly variables: Readonly<Record<string, string>>;
  readonly environment?: UserEnvironment['Service'];
}) {
  const files = yield* FileSystem.FileSystem;
  const watcher = yield* FileWatcher;
  const users =
    input.environment ??
    makeUserEnvironment({ shell: null, env: { PATH: join(input.root, 'bin'), ...input.variables }, world: null, home: null });
  const builtin = Layer.succeed(BuiltinAdapters, {
    sources: [{ id: 'login-fixture', origin: 'builtin', version: null, load: async () => () => input.providers }],
  });
  const registry = Context.get(yield* Layer.build(registryLayer.pipe(Layer.provide(builtin))), ProviderRegistry);
  const adapters = yield* makeHarnessAdapters;
  yield* adapters.declared(registry.current().harnesses);
  const environment = Context.make(UserEnvironment, users).pipe(
    Context.add(FileSystem.FileSystem, files),
    Context.add(HarnessAdapters, adapters),
  );
  const installs = yield* Effect.provide(makeInstalledHarnesses({ budgetMs: 1000 }), environment);
  const cliInputs = environment.pipe(
    Context.add(InstalledHarnesses, installs),
    Context.add(Terminals, terminals),
    Context.add(HostManagement, host),
    Context.add(TerminalEndings, endings),
    Context.add(TerminalRequests, requests),
    Context.add(Projects, projects),
  );
  const cli = yield* Layer.build(accountCliLayer.pipe(Layer.provide(Layer.succeedContext(cliInputs))));
  const rows = makeHarnessDirectoryStore({ home: input.root, machine: 'fixture' });
  const inputs = Context.make(FileSystem.FileSystem, files).pipe(
    Context.add(FileWatcher, watcher),
    Context.add(HarnessDirectories, rows),
    Context.add(ProviderRegistry, registry),
    Context.add(AccountCli, Context.get(cli, AccountCli)),
    Context.add(LoginPlaces, Context.get(cli, LoginPlaces)),
  );
  const logins = yield* Layer.build(defaultLoginsLayer.pipe(Layer.provide(Layer.succeedContext(inputs))));
  return { book: Context.get(logins, DefaultLogins), rows };
});

layer(Layer.merge(watchProcessLayer, BunFileSystem.layer), { excludeTestServices: true })('CLI login discovery', (it) => {
  it.effect('startup discovers exact profile and unset places without version probes and follows a burst of login changes', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'login-discovery-' });
      const bin = join(root, 'bin');
      const claudeDefault = join(root, 'claude-default');
      const codexDefault = join(root, 'codex-default');
      const explicit = `${join(root, 'profile-claude')}/`;
      yield* Effect.forEach([bin, claudeDefault, codexDefault, explicit], (directory) =>
        files.makeDirectory(directory, { recursive: true }),
      );
      yield* files.writeFileString(join(root, 'runs.jsonl'), '');
      yield* files.writeFileString(
        join(explicit, '.claude.json'),
        JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'first@example.test' }),
      );
      yield* files.writeFileString(join(codexDefault, 'auth.json'), JSON.stringify({ signed: true }));
      const script = executable(root, { claude: claudeDefault, codex: codexDefault });
      yield* files.writeFileString(join(bin, 'claude'), script, { mode: 0o755 });
      yield* files.writeFileString(join(bin, 'codex'), script, { mode: 0o755 });
      const claude = withDefault(claudeCode, claudeDefault);
      const codexCli = withDefault(codex, codexDefault);
      const { book, rows } = yield* makeRig({ root, providers: [claude, codexCli], variables: { CLAUDE_CONFIG_DIR: explicit } });
      yield* book.ready;
      if (!(yield* rows.of(codexCli.id)).some((row) => row.signed)) yield* whenRow(book, rows, codexCli.id, (row) => row?.signed === true);
      expect(yield* rows.of(claude.id)).toMatchObject([
        { directory: explicit, signed: true, label: 'first@example.test', requested: true },
      ]);
      expect(yield* rows.of(codexCli.id)).toMatchObject([{ directory: null, signed: true, requested: true }]);
      const initial = yield* starts(files, root);
      expect(
        initial.map(({ program, args, directory }) => ({ program, args, directory })).sort((a, b) => a.program.localeCompare(b.program)),
      ).toEqual([
        { program: 'claude', args: ['auth', 'status', '--json'], directory: explicit },
        { program: 'codex', args: ['login', 'status'], directory: null },
      ]);
      expect(initial.every((call) => call.cwd !== process.env.HOME)).toBe(true);
      yield* book.focus;
      expect(yield* starts(files, root)).toEqual(initial);

      yield* files.writeFileString(join(root, 'hold-claude'), 'hold');
      const waiting = yield* Effect.forkScoped(whenExists(join(root, 'started-claude')));
      yield* replaceLogin(files, join(explicit, '.claude.json'), { loggedIn: false });
      yield* Fiber.join(waiting);
      const latest = yield* Effect.forkScoped(
        whenRow(book, rows, claude.id, (row) => row?.signed === true && row.label === 'latest@example.test'),
      );
      yield* replaceLogin(files, join(explicit, '.claude.json'), { loggedIn: true, authMethod: 'claude.ai', email: 'middle@example.test' });
      yield* replaceLogin(files, join(explicit, '.claude.json'), { loggedIn: true, authMethod: 'claude.ai', email: 'latest@example.test' });
      yield* files.remove(join(root, 'hold-claude'));
      yield* files.writeFileString(join(root, 'release-claude'), 'release');
      yield* Fiber.join(latest);
      const after = yield* starts(files, root);
      expect(after.filter((call) => call.program === 'claude').length - 1).toBeLessThanOrEqual(2);
      expect((yield* rows.of(claude.id))[0]).toMatchObject({ directory: explicit, signed: true, label: 'latest@example.test' });

      const unreadable = yield* Effect.forkScoped(whenRow(book, rows, claude.id, (row) => row?.problem?.kind === 'unreadable'));
      yield* replaceLogin(files, join(explicit, '.claude.json'), { invalid: true });
      yield* Fiber.join(unreadable);
      expect(yield* book.observe(claude)).toMatchObject({
        directory: explicit,
        signed: true,
        label: 'latest@example.test',
        problem: { kind: 'unreadable' },
      });
      expect(yield* Effect.flip(book.current(claude))).toMatchObject({ code: 'login-unreadable' });
      const recovered = yield* Effect.forkScoped(
        whenRow(book, rows, claude.id, (row) => row?.problem == null && row?.signed === true && row.label === 'recovered@example.test'),
      );
      yield* replaceLogin(files, join(explicit, '.claude.json'), {
        loggedIn: true,
        authMethod: 'claude.ai',
        email: 'recovered@example.test',
      });
      yield* Fiber.join(recovered);
      expect((yield* rows.of(claude.id))[0]).toMatchObject({
        directory: explicit,
        signed: true,
        label: 'recovered@example.test',
        problem: null,
      });
    }),
  );

  it.effect('a later profile adds its exact address without retargeting the default login', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'login-profile-' });
      const bin = join(root, 'bin');
      const claudeDefault = join(root, 'claude-default');
      const codexDefault = join(root, 'codex-default');
      const explicit = `${join(root, 'profile-codex')}/`;
      yield* Effect.forEach([bin, claudeDefault, codexDefault, explicit], (directory) =>
        files.makeDirectory(directory, { recursive: true }),
      );
      yield* files.writeFileString(join(root, 'runs.jsonl'), '');
      yield* files.writeFileString(join(codexDefault, 'auth.json'), JSON.stringify({ signed: false }));
      yield* files.writeFileString(join(explicit, 'auth.json'), JSON.stringify({ signed: true }));
      yield* files.writeFileString(join(bin, 'codex'), executable(root, { claude: claudeDefault, codex: codexDefault }), { mode: 0o755 });
      let answer!: (profile: ProfileAnswer) => void;
      const profile = new Promise<ProfileAnswer>((resolve) => {
        answer = resolve;
      });
      const environment = makeUserEnvironment({
        shell: { desktopLaunch: () => true, managers: () => [], fallback: () => [], runtimes: () => [], read: () => profile },
        env: { PATH: bin },
        world: null,
        home: root,
      });
      const codexCli = withDefault(codex, codexDefault);
      const { book, rows } = yield* makeRig({ root, providers: [codexCli], variables: {}, environment });
      if (!(yield* rows.of(codexCli.id)).some((row) => row.directory === null))
        yield* whenRow(book, rows, codexCli.id, (row) => row?.directory === null && row.signed === false);
      expect((yield* rows.of(codexCli.id)).find((row) => row.directory === null)?.requested).toBeUndefined();
      const profileRow = yield* Effect.forkScoped(whenRow(book, rows, codexCli.id, (row) => row?.directory === explicit && row.signed));
      answer({ outcome: 'read', entries: [bin], detail: null, environment: { CODEX_HOME: explicit } });
      yield* Fiber.join(profileRow);
      expect(yield* rows.of(codexCli.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ directory: null, signed: false }),
          expect.objectContaining({ directory: explicit, signed: true, requested: true }),
        ]),
      );
      expect((yield* starts(files, root)).map(({ directory }) => directory)).toEqual([null, explicit]);
      const defaultRow = yield* Effect.forkScoped(whenRow(book, rows, codexCli.id, (row) => row?.directory === null && row.signed));
      yield* replaceLogin(files, join(codexDefault, 'auth.json'), { signed: true });
      yield* Fiber.join(defaultRow);
      expect(yield* rows.of(codexCli.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ directory: null, signed: true }),
          expect.objectContaining({ directory: explicit, signed: true }),
        ]),
      );
      expect((yield* starts(files, root)).map(({ directory }) => directory)).toEqual([null, explicit, null]);
    }),
  );

  it.effect('a persisted signed login is ready after restart while its fresh status is held', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'login-restart-' });
      const bin = join(root, 'bin');
      const claudeDefault = join(root, 'claude-default');
      const codexDefault = join(root, 'codex-default');
      yield* Effect.forEach([bin, claudeDefault, codexDefault], (directory) => files.makeDirectory(directory, { recursive: true }));
      yield* files.writeFileString(join(root, 'runs.jsonl'), '');
      yield* files.writeFileString(join(codexDefault, 'auth.json'), JSON.stringify({ signed: true }));
      yield* files.writeFileString(join(bin, 'codex'), executable(root, { claude: claudeDefault, codex: codexDefault }), { mode: 0o755 });
      const codexCli = withDefault(codex, codexDefault);
      const first = yield* Effect.scoped(
        Effect.gen(function* () {
          const { book, rows } = yield* makeRig({ root, providers: [codexCli], variables: {} });
          yield* book.ready;
          return (yield* rows.of(codexCli.id))[0];
        }),
      );
      expect(first).toMatchObject({ key: 'default', directory: null, signed: true, requested: true });
      yield* files.writeFileString(join(root, 'hold-codex'), 'hold');
      const statusStarted = yield* Effect.forkScoped(whenExists(join(root, 'started-codex')));
      const restarted = yield* makeRig({ root, providers: [codexCli], variables: {} });
      yield* Fiber.join(statusStarted);
      yield* restarted.book.ready;
      expect(yield* restarted.rows.of(codexCli.id)).toMatchObject([
        { key: first?.key, directory: null, signed: true, requested: true, problem: null },
      ]);
      const finished = yield* Effect.forkScoped(whenExists(join(root, 'finished-codex')));
      yield* files.remove(join(root, 'hold-codex'));
      yield* files.writeFileString(join(root, 'release-codex'), 'release');
      yield* Fiber.join(finished);
      expect((yield* starts(files, root)).map(({ program, args }) => ({ program, args }))).toEqual([
        { program: 'codex', args: ['login', 'status'] },
        { program: 'codex', args: ['login', 'status'] },
      ]);
    }),
  );

  it.effect('a refused watch does not settle discovery without a verdict, and focus restores file observation', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const watcher = yield* FileWatcher;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'login-watch-refusal-' });
      const bin = join(root, 'bin');
      const claudeDefault = join(root, 'claude-default');
      const codexDefault = join(root, 'codex-default');
      yield* Effect.forEach([bin, claudeDefault, codexDefault], (directory) => files.makeDirectory(directory, { recursive: true }));
      yield* files.writeFileString(join(root, 'runs.jsonl'), '');
      yield* files.writeFileString(join(codexDefault, 'auth.json'), JSON.stringify({ signed: true }));
      yield* files.writeFileString(join(bin, 'codex'), executable(root, { claude: claudeDefault, codex: codexDefault }), { mode: 0o755 });
      let refused = false;
      const recovering = FileWatcher.of({
        ...watcher,
        subscribe: (at, options, hearing) => {
          if (refused) return watcher.subscribe(at, options, hearing);
          refused = true;
          return Effect.fail(new WatchRefused({ message: 'the watch service is temporarily unavailable' }));
        },
      });
      const codexCli = withDefault(codex, codexDefault);
      const { book, rows } = yield* makeRig({ root, providers: [codexCli], variables: {} }).pipe(
        Effect.provideService(FileWatcher, recovering),
      );
      yield* book.ready;
      expect(yield* rows.of(codexCli.id)).toMatchObject([{ directory: null, signed: true, problem: null }]);
      yield* book.focus;
      const signedOut = yield* Effect.forkScoped(whenRow(book, rows, codexCli.id, (row) => row?.problem?.kind === 'signed-out'));
      yield* replaceLogin(files, join(codexDefault, 'auth.json'), { signed: false });
      yield* Fiber.join(signedOut);
      expect(yield* rows.of(codexCli.id)).toMatchObject([{ directory: null, signed: false, problem: { kind: 'signed-out' } }]);
    }),
  );

  it.effect('focus discovers a CLI installed after startup', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'login-install-' });
      const bin = join(root, 'bin');
      const claudeDefault = join(root, 'claude-default');
      const codexDefault = join(root, 'codex-default');
      yield* Effect.forEach([bin, claudeDefault, codexDefault], (directory) => files.makeDirectory(directory, { recursive: true }));
      yield* files.writeFileString(join(root, 'runs.jsonl'), '');
      yield* files.writeFileString(join(codexDefault, 'auth.json'), JSON.stringify({ signed: true }));
      const codexCli = withDefault(codex, codexDefault);
      const { book, rows } = yield* makeRig({ root, providers: [codexCli], variables: {} });
      yield* book.ready;
      expect(yield* rows.of(codexCli.id)).toEqual([]);
      expect(yield* starts(files, root)).toEqual([]);
      yield* files.writeFileString(join(bin, 'codex'), executable(root, { claude: claudeDefault, codex: codexDefault }), { mode: 0o755 });
      yield* book.focus;
      expect(yield* rows.of(codexCli.id)).toMatchObject([{ directory: null, signed: true, requested: true }]);
      expect((yield* starts(files, root)).map(({ program, args }) => ({ program, args }))).toEqual([
        { program: 'codex', args: ['login', 'status'] },
      ]);
    }),
  );
});
