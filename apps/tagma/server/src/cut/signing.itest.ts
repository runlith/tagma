import { X509Certificate } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem, PlatformError, Sink, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { SIGNING_NAME, signingIdentity } from './signing.js';

const LOGIN = '/Users/someone/Library/Keychains/login.keychain-db';

const minted = (): string => {
  const ran = Bun.spawnSync(
    [
      '/usr/bin/openssl',
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      '/dev/null',
      '-subj',
      `/CN=${SIGNING_NAME}`,
      '-days',
      '1',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (ran.exitCode !== 0) throw new Error(ran.stderr.toString());
  return ran.stdout.toString();
};

const PEMS = [minted(), minted(), minted()].map((pem) => ({
  pem,
  fingerprint: new X509Certificate(pem).fingerprint.replaceAll(':', ''),
}));

type Certificate = (typeof PEMS)[number];

type Keychain = {
  readonly identities: Array<{ readonly fingerprint: string; readonly name: string; readonly trouble: string }>;
  readonly certificates: Certificate[];
  readonly refusesImport?: boolean;
};

const homed = Effect.acquireRelease(
  Effect.sync(() => {
    const home = realpathSync(mkdtempSync('/tmp/tagma-signing-'));
    const standing = process.env.HOME;
    process.env.HOME = home;
    return { home, standing };
  }),
  ({ home, standing }) =>
    Effect.sync(() => {
      process.env.HOME = standing;
      rmSync(home, { recursive: true, force: true });
    }),
);

const machine = (keychain: Keychain) => {
  const unminted = PEMS.filter((one) => !keychain.certificates.some((held) => held.fingerprint === one.fingerprint));
  const answer = (args: readonly string[]): { readonly code: number; readonly text: string } => {
    if (args[0] === 'login-keychain') return { code: 0, text: `    "${LOGIN}"\n` };
    if (args[0] === 'find-identity') {
      const rows = keychain.identities.map((one, index) => `  ${index + 1}) ${one.fingerprint} "${one.name}" (${one.trouble})`);
      return {
        code: 0,
        text: `\nPolicy: Code Signing\n  Matching identities\n${rows.join('\n')}\n\n  Valid identities only\n     0 valid identities found\n`,
      };
    }
    if (args[0] === 'find-certificate') return { code: 0, text: keychain.certificates.map((one) => one.pem).join('') };
    if (args[0] === 'import' && keychain.refusesImport) return { code: 1, text: 'security: SecKeychainItemImport: refused' };
    if (args[0] === 'import') keychain.certificates.push(unminted.shift()!);
    return { code: 0, text: '' };
  };
  const imported = Effect.sync(() => {
    const minted = keychain.certificates.at(-1)!;
    keychain.identities.push({ fingerprint: minted.fingerprint, name: SIGNING_NAME, trouble: 'CSSMERR_TP_NOT_TRUSTED' });
    return ChildProcessSpawner.ExitCode(0);
  });
  return Effect.provideService(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        if (command._tag !== 'StandardCommand') throw new Error('signing runs one command at a time');
        const { code, text } = answer(command.args);
        const bytes = Stream.make(new TextEncoder().encode(text));
        const exited = Effect.succeed(ChildProcessSpawner.ExitCode(code));
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: command.args[0] === 'import' && code === 0 ? Effect.delay(imported, '80 millis') : exited,
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: bytes,
          stderr: Stream.empty,
          all: bytes,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    ),
  );
};

const files = Effect.provideService(
  FileSystem.FileSystem,
  FileSystem.makeNoop({ makeTempDirectory: () => Effect.succeed('/scratch'), remove: () => Effect.void }),
);

it.live('builds racing on a fresh machine create one identity, and every later build signs with it', () =>
  Effect.gen(function* () {
    yield* homed;
    const keychain: Keychain = { identities: [], certificates: [] };
    const raced = yield* Effect.all([signingIdentity, Effect.delay(signingIdentity, '20 millis')], { concurrency: 'unbounded' }).pipe(
      machine(keychain),
      files,
    );
    const later = yield* signingIdentity.pipe(machine(keychain), files);
    expect(keychain.identities).toHaveLength(1);
    const fingerprint = keychain.identities[0]!.fingerprint;
    expect(raced.map((one) => one.fingerprint)).toEqual([fingerprint, fingerprint]);
    expect(raced.filter((one) => one.created)).toHaveLength(1);
    expect(later).toEqual({ fingerprint, name: SIGNING_NAME, created: false });
  }),
);

it.live('the identity is found by its certificate even under another label', () =>
  Effect.gen(function* () {
    yield* homed;
    const [first] = PEMS;
    const keychain: Keychain = {
      identities: [{ fingerprint: first!.fingerprint, name: 'renamed in Keychain Access', trouble: 'CSSMERR_TP_NOT_TRUSTED' }],
      certificates: [first!],
    };
    const found = yield* signingIdentity.pipe(machine(keychain), files);
    expect(found).toEqual({ fingerprint: first!.fingerprint, name: SIGNING_NAME, created: false });
  }),
);

it.live('an identity that stands but cannot sign is refused and never replaced', () =>
  Effect.gen(function* () {
    yield* homed;
    const [first] = PEMS;
    for (const keychain of [
      { identities: [{ fingerprint: first!.fingerprint, name: SIGNING_NAME, trouble: 'CSSMERR_TP_CERT_EXPIRED' }], certificates: [first!] },
      { identities: [], certificates: [first!] },
    ] satisfies Keychain[]) {
      const refused = yield* Effect.flip(signingIdentity.pipe(machine(keychain), files));
      expect(refused._tag).toBe('SigningRefused');
      expect(refused.unblock.length).toBeGreaterThan(0);
      expect(keychain.certificates).toEqual([first!]);
    }
  }),
);

it.live('a refused creation whose scratch also stays behind answers both, each with its way out', () =>
  Effect.gen(function* () {
    yield* homed;
    const keychain: Keychain = { identities: [], certificates: [], refusesImport: true };
    const stuck = Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        makeTempDirectory: () => Effect.succeed('/scratch'),
        remove: () => Effect.fail(PlatformError.systemError({ _tag: 'PermissionDenied', module: 'FileSystem', method: 'remove' })),
      }),
    );
    const refused = yield* Effect.flip(signingIdentity.pipe(machine(keychain), stuck));
    expect(refused.detail).toContain('security import exited 1');
    expect(refused.detail).toContain('/scratch');
    expect(refused.unblock).toHaveLength(2);
  }),
);
