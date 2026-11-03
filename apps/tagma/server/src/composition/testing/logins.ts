import { existsSync, watch } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { Clock, Effect, FileSystem } from 'effect';
import { type Adapter, defineAdapter, type Provider } from '@runlith/tagma/adapter/provider';
import { WORLD_COMMAND } from '../../installation/contract/wire/layout.js';
import type { FixtureScope } from '../../platform/testing/scope.js';
import type { AdapterSource } from '../../providers/contract/service/registry.js';
import { SERVER_SRC } from './repoRoot.js';

export type LoginName = 'claude' | 'codex';
export type LoginState = 'absent' | 'held' | 'signed-in' | 'signed-out' | 'unsupported' | 'failing' | 'keyring';
export type LoginsParams = {
  readonly claude?: LoginState;
  readonly codex?: LoginState;
  readonly place?: 'default' | 'exported';
};

export type LoginStart = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly variable: string | null;
  readonly mise: string | null;
  readonly tty: boolean;
};

export type Logins = {
  readonly answer: (name: LoginName, state: LoginState) => Effect.Effect<void>;
  readonly started: (name: LoginName) => Effect.Effect<void>;
  readonly starts: (name: LoginName) => Effect.Effect<readonly LoginStart[]>;
  readonly place: (name: LoginName) => string;
  readonly agent: { readonly report: string };
};

export const LOGIN_LABELS = { claude: 'fixture@example.com', codex: 'ChatGPT' } as const satisfies Record<LoginName, string>;

const VARIABLES = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' } as const satisfies Record<LoginName, string>;
const STATUS_FILE = '.fixture-status';
const AGENT = join(SERVER_SRC, 'external-harnesses', 'testing', 'acpAgent.ts');
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

const common = (name: LoginName, control: string, place: string): string =>
  [
    '#!/bin/sh',
    `CONTROL='${control}'`,
    `PLACE="\${${VARIABLES[name]}:-${place}}"`,
    'if [ -t 0 ]; then TTY=1; else TTY=0; fi',
    'ARGV="$*"',
    `printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$ARGV" "$PWD" "\${${VARIABLES[name]}-unset}" "\${__MISE_DIFF-unset}" "$TTY" >> "$CONTROL/starts.log"`,
    'holding() {',
    '  if [ -e "$CONTROL/hold" ]; then',
    '    : > "$CONTROL/started"',
    '    while [ -e "$CONTROL/hold" ]; do /bin/sleep 0.05; done',
    '  fi',
    '}',
  ].join('\n');

const claudeScript = (control: string, place: string): string =>
  [
    common('claude', control, place),
    'case "$1 $2" in',
    '  "auth status")',
    '    holding',
    '    STATE="$(/bin/cat "$PLACE/' + STATUS_FILE + '" 2>/dev/null)"',
    '    case "$STATE" in',
    `      signed-in) printf '{"loggedIn":true,"authMethod":"claude.ai","email":"${LOGIN_LABELS.claude}","orgName":"Fixture"}\\n'; exit 0;;`,
    `      unsupported) printf '{"loggedIn":true,"authMethod":"api-key"}\\n'; exit 0;;`,
    "      failing) printf 'fixture claude failed' >&2; exit 3;;",
    `      *) printf '{"loggedIn":false}\\n'; exit 1;;`,
    '    esac;;',
    '  "auth login")',
    '    /bin/mkdir -p "$PLACE"',
    `    printf 'signed-in' > "$PLACE/${STATUS_FILE}"`,
    '    /bin/cp "$CONTROL/login.json" "$PLACE/.claude.json"',
    "    printf 'Login successful\\n'; exit 0;;",
    'esac',
    "case \"$1\" in --version) printf '2.0.0 (Claude Code)\\n'; exit 0;; esac",
    'exit 0',
    '',
  ].join('\n');

const codexScript = (control: string, place: string): string =>
  [
    common('codex', control, place),
    'case "$1 $2" in',
    '  "login status")',
    '    holding',
    '    STATE="$(/bin/cat "$PLACE/' + STATUS_FILE + '" 2>/dev/null)"',
    '    case "$STATE" in',
    "      signed-in) printf 'Logged in using ChatGPT\\n' >&2; exit 0;;",
    "      unsupported) printf 'Logged in using an API key - sk-***\\n' >&2; exit 0;;",
    "      failing) printf 'fixture codex failed' >&2; exit 3;;",
    "      *) printf 'Not logged in\\n' >&2; exit 1;;",
    '    esac;;',
    '  "login "*)',
    '    /bin/mkdir -p "$PLACE"',
    `    printf 'signed-in' > "$PLACE/${STATUS_FILE}"`,
    '    /bin/cp "$CONTROL/login.json" "$PLACE/auth.json"',
    "    printf 'Logged in using ChatGPT\\n' >&2; exit 0;;",
    'esac',
    "case \"$1\" in --version) printf 'codex-cli 0.50.0\\n'; exit 0;; esac",
    'exit 0',
    '',
  ].join('\n');

const claudeLogin = JSON.stringify({
  oauthAccount: { accountUuid: 'fixture-claude', organizationUuid: 'fixture-org', emailAddress: LOGIN_LABELS.claude },
});

const jwt = (claims: unknown): string => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

const codexLogin = (now: number): string =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: jwt({ exp: (now + 3_600_000) / 1000 }),
      refresh_token: 'fixture-codex-refresh',
      id_token: jwt({ email: 'codex@example.com' }),
      account_id: 'fixture-codex-account',
    },
  });

const appears = (path: string): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const watcher = watch(dirname(path), () => {
      if (!existsSync(path)) return;
      watcher.close();
      resume(Effect.void);
    });
    if (existsSync(path)) {
      watcher.close();
      resume(Effect.void);
    }
    return Effect.sync(() => watcher.close());
  });

const without = (path: string, programs: readonly string[]): boolean =>
  isAbsolute(path) && !programs.some((program) => existsSync(join(path, program)));

export const installLogins = Effect.fn('testing.installLogins')(function* (fixture: FixtureScope, params: LoginsParams) {
  const files = yield* FileSystem.FileSystem;
  const root = yield* fixture.directory('logins');
  const bin = yield* fixture.directory('logins/bin');
  const world = yield* fixture.directory('logins/world');
  const names = ['claude', 'codex'] as const;
  const dirs = {
    claude: { control: yield* fixture.directory('logins/claude-control'), place: yield* fixture.directory('logins/claude-home') },
    codex: { control: yield* fixture.directory('logins/codex-control'), place: yield* fixture.directory('logins/codex-home') },
  };
  const now = yield* Clock.currentTimeMillis;
  const report = join(root, 'agent.report');
  yield* files.writeFileString(join(dirs.claude.control, 'login.json'), claudeLogin);
  yield* files.writeFileString(join(dirs.codex.control, 'login.json'), codexLogin(now));
  yield* files.writeFileString(
    join(world, WORLD_COMMAND),
    ['#!/bin/sh', `exec '${process.execPath}' '${AGENT}' --report '${report}' --mode tagma`, ''].join('\n'),
    { mode: 0o755 },
  );

  const scriptOf = (name: LoginName) =>
    name === 'claude' ? claudeScript(dirs.claude.control, dirs.claude.place) : codexScript(dirs.codex.control, dirs.codex.place);
  const loginFile = (name: LoginName) => join(dirs[name].place, name === 'claude' ? '.claude.json' : 'auth.json');
  const remove = (path: string) => files.remove(path, { force: true }).pipe(Effect.orDie);
  const installed = (name: LoginName) => files.exists(join(bin, name)).pipe(Effect.orDie);
  const answer = Effect.fn('testing.logins.answer')(function* (name: LoginName, state: LoginState) {
    const { control, place } = dirs[name];
    if (state === 'absent') {
      yield* remove(join(bin, name));
      return;
    }
    if (!(yield* installed(name))) yield* files.writeFileString(join(bin, name), scriptOf(name), { mode: 0o755 }).pipe(Effect.orDie);
    if (state === 'held') {
      yield* remove(join(control, 'started'));
      yield* files.writeFileString(join(control, 'hold'), 'held').pipe(Effect.orDie);
      return;
    }
    const status = state === 'keyring' ? 'signed-in' : state;
    yield* files.writeFileString(join(place, STATUS_FILE), status).pipe(Effect.orDie);
    const document = status === 'signed-in' && state !== 'keyring' ? yield* files.readFileString(join(control, 'login.json')).pipe(Effect.orDie) : null;
    if (document !== null) yield* files.writeFileString(loginFile(name), document).pipe(Effect.orDie);
    else if (name === 'claude') yield* files.writeFileString(loginFile(name), '{}').pipe(Effect.orDie);
    else yield* remove(loginFile(name));
    yield* remove(join(control, 'hold'));
    yield* remove(join(control, 'started'));
  });
  for (const name of names) {
    const initial = params[name] ?? 'absent';
    if (initial === 'held') yield* answer(name, 'signed-out');
    yield* answer(name, initial);
  }

  const starts = (name: LoginName) =>
    files.readFileString(join(dirs[name].control, 'starts.log')).pipe(
      Effect.map((log) =>
        log
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line): LoginStart => {
            const [argv = '', cwd = '', variable = 'unset', mise = 'unset', tty = '0'] = line.split('\t');
            return {
              argv: argv === '' ? [] : argv.split(' '),
              cwd,
              variable: variable === 'unset' ? null : variable,
              mise: mise === 'unset' ? null : mise,
              tty: tty === '1',
            };
          }),
      ),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed<readonly LoginStart[]>([])),
      Effect.orDie,
    );

  const stood = process.env.PATH ?? '';
  const standing = stood.split(':').filter((entry) => entry !== '' && without(entry, ['claude', 'codex']));
  const exported = params.place === 'exported';
  const saved = { path: process.env.PATH, claude: process.env.CLAUDE_CONFIG_DIR, codex: process.env.CODEX_HOME };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.PATH = [world, bin, ...standing, ...SYSTEM_PATH.filter((entry) => !standing.includes(entry))].join(':');
      if (exported) {
        process.env.CLAUDE_CONFIG_DIR = dirs.claude.place;
        process.env.CODEX_HOME = dirs.codex.place;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
        delete process.env.CODEX_HOME;
      }
    }),
    () =>
      Effect.sync(() => {
        const restore = (key: 'PATH' | 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME', value: string | undefined) => {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        };
        restore('PATH', saved.path);
        restore('CLAUDE_CONFIG_DIR', saved.claude);
        restore('CODEX_HOME', saved.codex);
      }),
  );

  const logins: Logins = {
    answer,
    started: (name) => appears(join(dirs[name].control, 'started')),
    starts,
    place: (name) => dirs[name].place,
    agent: { report },
  };
  return logins;
});

const relocated = (provider: Provider, places: Readonly<Record<LoginName, string>>): Provider => {
  const named = (variable: string | undefined) => (Object.keys(VARIABLES) as LoginName[]).find((name) => VARIABLES[name] === variable);
  if (provider.kind === 'harness' && provider.auth === 'cli' && provider.accounts?.discovery !== undefined) {
    const { accounts } = provider;
    const name = named(accounts.discovery?.variable);
    return name === undefined || accounts.discovery === undefined
      ? provider
      : { ...provider, accounts: { ...accounts, discovery: { ...accounts.discovery, directory: places[name] } } };
  }
  if (provider.kind === 'wire' && provider.borrows !== undefined) {
    const { borrows } = provider;
    const place = borrows.provider === 'codex' ? places.codex : borrows.provider === 'claude-code' ? places.claude : undefined;
    return place === undefined ? provider : { ...provider, borrows: { ...borrows, read: (directory) => borrows.read(directory ?? place) } };
  }
  return provider;
};

const adapterOf = (adapter: Adapter, places: Readonly<Record<LoginName, string>>): Adapter =>
  defineAdapter((host) => adapter(host).map((provider) => relocated(provider, places)), adapter.settings);

export const relocatedAdapters = (sources: readonly AdapterSource[], logins: Logins): readonly AdapterSource[] => {
  const places = { claude: logins.place('claude'), codex: logins.place('codex') };
  return sources.map((source) => ({
    ...source,
    load: async () => {
      const entry = await source.load();
      return { ...entry, adapter: adapterOf(entry.adapter, places) };
    },
  }));
};

export const noLogins: Logins = {
  answer: () => Effect.die(new Error('this world has no logins fixture; build it with { logins }')),
  started: () => Effect.die(new Error('this world has no logins fixture; build it with { logins }')),
  starts: () => Effect.die(new Error('this world has no logins fixture; build it with { logins }')),
  place: () => {
    throw new Error('this world has no logins fixture; build it with { logins }');
  },
  agent: { report: '' },
};
