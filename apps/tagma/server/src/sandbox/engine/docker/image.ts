import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Effect, FileSystem, Schema, Stream, type Duration } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import type { Installation } from '../../../installation/contract/wire/manifest.js';
import { GuestUnavailable } from './wire.js';

const DOCKERFILE = fileURLToPath(new URL('./image/Dockerfile', import.meta.url));
const CONTEXT = fileURLToPath(new URL('.', import.meta.url));
const HELPER = fileURLToPath(new URL('./helper.ts', import.meta.url));
const PROXY = fileURLToPath(new URL('./proxy.ts', import.meta.url));

export const GUEST_IMAGE_REPOSITORY = 'tagma-code-guest';

export const GUEST_REVISION_LABEL = 'tagma.guest.revision';

export const GUEST_PROTOCOL_LABEL = 'tagma.guest.protocol';
export const GUEST_PROTOCOL = '1';
const LEGACY_REVISION = 'b0759ca46b90f766';
const ImageMetadata = Schema.Struct({
  Id: Schema.String,
  Os: Schema.String,
  Architecture: Schema.String,
  Config: Schema.Struct({ Labels: Schema.NullOr(Schema.Record(Schema.String, Schema.String)) }),
});
const decodeImage = Schema.decodeUnknownResult(Schema.fromJsonString(ImageMetadata));

export type GuestImage = {
  readonly reference: string;
  readonly digest: string;
  readonly revision: string;
};

export const guestRevision = Effect.fn('sandbox.guestRevision')(function* (installation: Installation | undefined) {
  const fs = yield* FileSystem.FileSystem;
  const sources = yield* Effect.all([fs.readFile(DOCKERFILE), fs.readFile(HELPER), fs.readFile(PROXY)]).pipe(
    Effect.mapError(
      (cause) =>
        new GuestUnavailable({
          container: GUEST_IMAGE_REPOSITORY,
          reason:
            installation === undefined
              ? `the guest image sources beside this server at ${CONTEXT} could not be read (${cause.message}); this checkout carries them, so nothing here says whether a guest could be raised`
              : `installation ${installation.manifest.identity.build} carries no default guest image build context at ${CONTEXT}; use a prepared tree or a compatible named image, or build the default image from a checkout`,
        }),
    ),
  );
  return createHash('sha256').update(sources[0]).update(sources[1]).update(sources[2]).update(GUEST_PROTOCOL).digest('hex').slice(0, 16);
});

export const buildGuestImage = Effect.fn('sandbox.buildGuestImage')(function* (
  installation: Installation | undefined,
): Effect.fn.Return<GuestImage, GuestUnavailable, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  const revision = yield* guestRevision(installation);
  const reference = `${GUEST_IMAGE_REPOSITORY}:${revision}`;
  const standing = yield* digestOf(reference);
  if (standing === null) {
    const built = yield* dockerSaid(
      [
        'build',
        '--file',
        DOCKERFILE,
        '--tag',
        reference,
        '--label',
        `${GUEST_REVISION_LABEL}=${revision}`,
        '--label',
        `${GUEST_PROTOCOL_LABEL}=${GUEST_PROTOCOL}`,
        CONTEXT,
      ],
      'build the guest image',
      { timeout: '120 seconds' },
    );
    if (built.code !== 0) {
      return yield* new GuestUnavailable({ container: reference, reason: `the guest image did not build: ${tail(built.output)}` });
    }
  }
  const target = yield* namedImage(reference);
  if (target.image.revision !== revision || (standing !== null && target.image.digest !== standing)) {
    return yield* new GuestUnavailable({ container: reference, reason: 'the image differs from its build identity' });
  }
  return target.image;
});

export const namedImage = Effect.fn('GuestImage.named')(function* (reference: string) {
  const said = yield* dockerSaid(['image', 'inspect', '--format', '{{json .}}', reference], 'read a named target image');
  if (said.code !== 0) {
    return yield* new GuestUnavailable({
      container: reference,
      reason: `this engine carries no image ${reference}: ${tail(said.output)}`,
    });
  }
  const decoded = decodeImage(said.output);
  if (decoded._tag === 'Failure') {
    return yield* new GuestUnavailable({ container: reference, reason: 'Docker returned unreadable image metadata' });
  }
  const metadata = decoded.success;
  const digest = metadata.Id;
  const platform = `${metadata.Os}/${metadata.Architecture}`;
  const revision = metadata.Config.Labels?.[GUEST_REVISION_LABEL] ?? '';
  const protocol = metadata.Config.Labels?.[GUEST_PROTOCOL_LABEL];
  if (revision === '' || revision === '<no value>') {
    return yield* new GuestUnavailable({
      container: reference,
      reason: `${reference} carries no ${GUEST_REVISION_LABEL}, so it ships no guest helper and no world could be opened over it`,
    });
  }
  const legacy = protocol === undefined && revision === LEGACY_REVISION;
  if (protocol !== GUEST_PROTOCOL && !legacy) {
    return yield* new GuestUnavailable({
      container: reference,
      reason: `${reference} declares unsupported guest protocol ${protocol || 'none'} at revision ${revision}`,
    });
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(digest) || !/^linux\/[a-z0-9_]+$/.test(platform)) {
    return yield* new GuestUnavailable({ container: reference, reason: 'the image identity or Linux platform is invalid' });
  }
  return { image: { reference, digest, revision } satisfies GuestImage, platform };
});

const digestOf = Effect.fn('GuestImage.digestOf')(function* (reference: string) {
  const named = yield* dockerSaid(['image', 'inspect', '--format', '{{.Id}}', reference], 'read the guest image digest');
  if (named.code !== 0) {
    if (/no such (image|object)/i.test(named.output)) return null;
    return yield* new GuestUnavailable({ container: reference, reason: `Docker could not read the image (exit ${named.code})` });
  }
  const digest = named.output.trim();
  if (digest === '') return yield* new GuestUnavailable({ container: reference, reason: 'Docker returned no image digest' });
  return digest;
});

export const dockerSaid = Effect.fn('GuestImage.docker')(function* (
  args: readonly string[],
  doing: string,
  options: { readonly timeout?: Duration.Input | null } = {},
) {
  const work = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make('docker', [...args], { stdin: 'ignore' });
      const output = yield* handle.all.pipe(Stream.decodeText(), Stream.mkString);
      const code = yield* handle.exitCode;
      return { code: Number(code), output };
    }),
  ).pipe(
    Effect.catch((cause) => Effect.fail(new GuestUnavailable({ container: 'docker', reason: `could not ${doing}: ${cause.message}` }))),
  );
  const timeout = options.timeout === undefined ? '15 seconds' : options.timeout;
  return yield* timeout === null
    ? work
    : work.pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.fail(
              new GuestUnavailable({ container: 'docker', reason: `could not ${doing}: Docker did not finish within ${String(timeout)}` }),
            ),
        }),
      );
});

function tail(output: string): string {
  const lines = output.trim().split('\n');
  return lines.slice(Math.max(0, lines.length - 12)).join('\n');
}
