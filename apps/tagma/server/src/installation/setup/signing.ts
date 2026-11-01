import { X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Clock, Cause, Data, Effect, Exit, FileSystem, Option, type PlatformError } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { type LockBusy, type LockUnavailable, withFileLock } from '@runlith/file-lock/FileLock';
import { type CommandAnswer, type CommandUnavailable, output } from '../cut/command.js';

export const SIGNING_NAME = 'Tagma Local Signing';

export class SigningRefused extends Data.TaggedError('SigningRefused')<{
  readonly detail: string;
  readonly unblock: readonly string[];
}> {}

export type SigningIdentity = { readonly fingerprint: string; readonly name: string; readonly created: boolean };

export const signingNotice = (identity: SigningIdentity): string =>
  `signing with "${identity.name}" ${identity.fingerprint}${identity.created ? ', created for this machine now' : ''}; if macOS asks whether codesign may use its key, answer "Always Allow" — "Allow" asks again at every signature`;

type Row = { readonly fingerprint: string; readonly name: string; readonly trouble: string | null };

type Standing = { readonly _tag: 'One'; readonly fingerprint: string } | { readonly _tag: 'None' };

type Machine = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem;

const SECURITY = '/usr/bin/security';
const OPENSSL = '/usr/bin/openssl';
const CODESIGN = '/usr/bin/codesign';
const UNTRUSTED = 'CSSMERR_TP_NOT_TRUSTED';
const LAST_DAY = Date.UTC(9999, 11, 31);
const DAY_MS = 86_400_000;
const LOCK_FILE = 'signing.lock';
const CREATION_WAIT_MS = 120_000;
const ROW = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.*)"(?:\s+\((.+)\))?\s*$/;
const PEM = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

const resetWarning = 'macOS then asks again for every permission it gave Tagma';

const anew = (fingerprint: string, keychain: string): string =>
  `delete it to have the next build create a new identity — ${resetWarning}: ${SECURITY} delete-identity -Z ${fingerprint} '${keychain}'`;

const refused = (detail: string, unblock: ReadonlyArray<string>) => new SigningRefused({ detail, unblock: [...unblock] });

const unreadable = (what: string, keychain: string, text: string) =>
  refused(
    `${what} answered for '${keychain}' in a form the build cannot read, so whether "${SIGNING_NAME}" stands there is unknown: ${text.trim().slice(0, 400)}`,
    [`look for "${SIGNING_NAME}" in '${keychain}' with Keychain Access; once ${what} answers in its usual form, build again`],
  );

const asked = (command: string, args: readonly string[]): Effect.Effect<CommandAnswer, SigningRefused, Machine> =>
  output(command, args, '/', {}).pipe(
    Effect.mapError((failure: CommandUnavailable) =>
      refused(failure.detail, [`${command} ships with macOS; restore it, then build again`, ...failure.unblock]),
    ),
  );

const done = (what: string, command: string, args: readonly string[], unblock: string) =>
  Effect.flatMap(asked(command, args), (answer) =>
    answer.status === 0
      ? Effect.succeed(answer.text)
      : Effect.fail(refused(`${what} exited ${answer.status}: ${answer.text.trim()}`, [unblock])),
  );

const inScratch = <A>(work: (at: string) => Effect.Effect<A, SigningRefused, Machine>): Effect.Effect<A, SigningRefused, Machine> =>
  Effect.flatMap(FileSystem.FileSystem, (files) =>
    Effect.acquireUseRelease(
      files
        .makeTempDirectory({ prefix: 'tagma-signing-' })
        .pipe(
          Effect.mapError((error: PlatformError.PlatformError) =>
            refused(`a temporary directory could not be made: ${error.reason._tag}`, ['free the temporary directory, then build again']),
          ),
        ),
      (at) => Effect.exit(work(at)),
      (at, ended) =>
        files.remove(at, { recursive: true }).pipe(
          Effect.mapError((error: PlatformError.PlatformError) => {
            const left = refused(
              `${at} could not be removed (${error.reason._tag}), and it holds the private key of "${SIGNING_NAME}" in the clear`,
              [`delete ${at} yourself, then build again`],
            );
            const first = Exit.isSuccess(ended) && Exit.isFailure(ended.value) ? Cause.findErrorOption(ended.value.cause) : Option.none();
            return Option.isSome(first)
              ? refused(`${first.value.detail}; then ${left.detail}`, [...left.unblock, ...first.value.unblock])
              : left;
          }),
        ),
    ),
  ).pipe(Effect.flatten);

const loginKeychain = Effect.flatMap(
  done('security login-keychain', SECURITY, ['login-keychain'], 'restore the login keychain in Keychain Access, then build again'),
  (text) => {
    const path = /"(.+)"/.exec(text)?.[1];
    return path === undefined
      ? Effect.fail(refused('no login keychain answers for this user', ['restore the login keychain in Keychain Access, then build again']))
      : Effect.succeed(path);
  },
);

const identities = (keychain: string): Effect.Effect<ReadonlyArray<Row>, SigningRefused, Machine> =>
  Effect.flatMap(
    done('security find-identity', SECURITY, ['find-identity', '-p', 'codesigning', keychain], `unlock '${keychain}', then build again`),
    (text) => {
      const rows = new Map<string, Row>();
      for (const line of (text.split('Valid identities only')[0] ?? '').split('\n')) {
        if (!/^\s*\d+\)/.test(line)) continue;
        const row = ROW.exec(line);
        if (row === null) return Effect.fail(unreadable('security find-identity', keychain, line));
        rows.set(row[1]!, { fingerprint: row[1]!, name: row[2]!, trouble: row[3] ?? null });
      }
      return Effect.succeed([...rows.values()]);
    },
  );

const certificates = (keychain: string): Effect.Effect<ReadonlyArray<string>, SigningRefused, Machine> =>
  Effect.flatMap(
    done(
      'security find-certificate',
      SECURITY,
      ['find-certificate', '-a', '-c', SIGNING_NAME, '-p', keychain],
      `unlock '${keychain}', then build again`,
    ),
    (text) => {
      const blocks = text.match(PEM) ?? [];
      if (blocks.length === 0 && text.trim() !== '') return Effect.fail(unreadable('security find-certificate', keychain, text));
      const named = new Set<string>();
      for (const block of blocks) {
        let certificate: X509Certificate;
        try {
          certificate = new X509Certificate(block);
        } catch {
          return Effect.fail(unreadable('security find-certificate', keychain, block));
        }
        if (certificate.subject.split('\n').includes(`CN=${SIGNING_NAME}`)) {
          named.add(certificate.fingerprint.replaceAll(':', '').toUpperCase());
        }
      }
      return Effect.succeed([...named]);
    },
  );

const standing = Effect.fnUntraced(function* (keychain: string): Effect.fn.Return<Standing, SigningRefused, Machine> {
  const [rows, named] = yield* Effect.all([identities(keychain), certificates(keychain)], { concurrency: 'unbounded' });
  const ours = rows.filter((row) => row.name === SIGNING_NAME || named.includes(row.fingerprint));
  if (ours.length > 1) {
    return yield* Effect.fail(
      refused(`${ours.length} identities of "${SIGNING_NAME}" stand in '${keychain}', and the build signs with exactly one`, [
        `keep the one Tagma was signed with and delete the others: ${ours.map((one) => `${SECURITY} delete-identity -Z ${one.fingerprint} '${keychain}'`).join('; ')}`,
      ]),
    );
  }
  const one = ours[0];
  if (one !== undefined) {
    if (one.trouble !== null && one.trouble !== UNTRUSTED) {
      return yield* Effect.fail(
        refused(`the identity "${SIGNING_NAME}" (${one.fingerprint}) in '${keychain}' cannot sign: ${one.trouble}`, [
          anew(one.fingerprint, keychain),
        ]),
      );
    }
    return { _tag: 'One', fingerprint: one.fingerprint } as const;
  }
  if (named.length > 0) {
    return yield* Effect.fail(
      refused(
        `a certificate of "${SIGNING_NAME}" stands in '${keychain}' and no code-signing identity answers to it: its private key is gone or it cannot sign code`,
        [
          `restore its private key from a backup of '${keychain}', then build again`,
          `delete it to have the next build create a new identity — ${resetWarning}: ${named.map((fingerprint) => `${SECURITY} delete-certificate -Z ${fingerprint} '${keychain}'`).join('; ')}`,
        ],
      ),
    );
  }
  return { _tag: 'None' } as const;
});

const created = (keychain: string): Effect.Effect<string, SigningRefused, Machine> =>
  inScratch((at) =>
    Effect.gen(function* () {
      const again = `fix what it names, then build again: the build creates "${SIGNING_NAME}" in '${keychain}' while none stands there`;
      const secret = crypto.randomUUID();
      const days = String(Math.floor((LAST_DAY - (yield* Clock.currentTimeMillis)) / DAY_MS));
      yield* done(
        'openssl req',
        OPENSSL,
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:3072',
          '-nodes',
          '-keyout',
          `${at}/key.pem`,
          '-out',
          `${at}/certificate.pem`,
          '-days',
          days,
          '-subj',
          `/CN=${SIGNING_NAME}`,
          '-addext',
          'keyUsage=critical,digitalSignature',
          '-addext',
          'extendedKeyUsage=critical,codeSigning',
          '-addext',
          'basicConstraints=critical,CA:false',
        ],
        again,
      );
      yield* done(
        'openssl pkcs12',
        OPENSSL,
        [
          'pkcs12',
          '-export',
          '-inkey',
          `${at}/key.pem`,
          '-in',
          `${at}/certificate.pem`,
          '-name',
          SIGNING_NAME,
          '-out',
          `${at}/identity.p12`,
          '-passout',
          `pass:${secret}`,
        ],
        again,
      );
      yield* done(
        'security import',
        SECURITY,
        ['import', `${at}/identity.p12`, '-k', keychain, '-f', 'pkcs12', '-P', secret, '-T', CODESIGN, '-x'],
        again,
      );
      const after = yield* standing(keychain);
      if (after._tag === 'One') return after.fingerprint;
      return yield* Effect.fail(
        refused(`"${SIGNING_NAME}" was imported into '${keychain}', and no code-signing identity answers to it`, [again]),
      );
    }),
  );

const exclusive = <A>(work: Effect.Effect<A, SigningRefused, Machine>): Effect.Effect<A, SigningRefused, Machine> => {
  const path = join(tmpdir(), LOCK_FILE);
  return withFileLock(path, CREATION_WAIT_MS, () => work).pipe(
    Effect.catchTag('LockBusy', (busy: LockBusy) =>
      Effect.fail(
        refused(`another build has been creating "${SIGNING_NAME}" for ${Math.round(busy.waitedMs / 1000)} s and still holds ${path}`, [
          'let that build finish, then build again',
        ]),
      ),
    ),
    Effect.catchTag('LockUnavailable', (failure: LockUnavailable) =>
      Effect.fail(refused(`${path} could not be locked: ${failure.reason}`, [`make ${path} writable on a local disk, then build again`])),
    ),
  );
};

const DEVELOPER_ID = /^Developer ID Application: .+ \(([A-Z0-9]{10})\)$/;

export const developerTeam = (identity: SigningIdentity): string | null => DEVELOPER_ID.exec(identity.name)?.[1] ?? null;

export const releaseIdentity = Effect.fn('installation.releaseIdentity')(function* (
  team: string | null,
): Effect.fn.Return<SigningIdentity, SigningRefused, Machine> {
  const keychain = yield* loginKeychain;
  const rows = (yield* identities(keychain)).filter(
    (row) => DEVELOPER_ID.test(row.name) && (team === null || DEVELOPER_ID.exec(row.name)?.[1] === team),
  );
  const usable = rows.filter((row) => row.trouble === null);
  const create = 'Xcode → Settings → Apple Accounts → the team → Manage Certificates → + → Developer ID Application';
  if (usable.length === 0) {
    const broken = rows.map((row) => `"${row.name}" (${row.fingerprint}): ${row.trouble}`);
    return yield* Effect.fail(
      refused(
        broken.length === 0
          ? `no "Developer ID Application" identity${team === null ? '' : ` of team ${team}`} stands in '${keychain}', and a release is signed with Developer ID so macOS opens it once Apple notarizes it`
          : `no "Developer ID Application" identity in '${keychain}' can sign: ${broken.join('; ')}`,
        [`import the backup .p12 of the Developer ID Application identity into '${keychain}' with Keychain Access`, create],
      ),
    );
  }
  const teams = new Set(usable.map((row) => DEVELOPER_ID.exec(row.name)?.[1]));
  if (teams.size > 1) {
    return yield* Effect.fail(
      refused(
        `Developer ID identities of ${teams.size} teams stand in '${keychain}' (${usable.map((row) => `"${row.name}"`).join(', ')}), and every release is signed by one team — another one makes macOS ask again for every permission it gave Tagma`,
        [
          'name the team that signs this distribution in its descriptor’s signing',
          `keep the identity of the team that signs Tagma and remove the others from '${keychain}' with Keychain Access`,
        ],
      ),
    );
  }
  const one = usable[0]!;
  return { fingerprint: one.fingerprint, name: one.name, created: false };
});

export const signingIdentity: Effect.Effect<SigningIdentity, SigningRefused, Machine> = Effect.gen(function* () {
  const keychain = yield* loginKeychain;
  const first = yield* Effect.result(standing(keychain));
  if (first._tag === 'Success' && first.success._tag === 'One')
    return { fingerprint: first.success.fingerprint, name: SIGNING_NAME, created: false };
  return yield* exclusive(
    Effect.gen(function* () {
      const again = yield* standing(keychain);
      if (again._tag === 'One') return { fingerprint: again.fingerprint, name: SIGNING_NAME, created: false };
      return { fingerprint: yield* created(keychain), name: SIGNING_NAME, created: true };
    }),
  );
});
