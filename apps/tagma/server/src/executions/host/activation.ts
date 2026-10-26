import { Effect, FileSystem, Schema } from 'effect';
import { readArtifact, verifyArtifact, type ArtifactFailure } from '@runlith/executions/hostArtifacts';
import { HostRegistration, type RegistrationReadFailure } from '@runlith/executions/HostRegistration';
import type { ArtifactManifest, Digest } from '@runlith/executions/protocol/artifact';
import { bootPath, HostBoot as HostBootFile, type HostLifetime } from '@runlith/executions/protocol/boot';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import type { Registration } from '@runlith/executions/protocol/registration';
import { bootInput, bootText } from './boot.js';

export type SchemaPosition = { readonly applied: number; readonly latest: string | null };

export type SchemaOffer = {
  readonly database: SchemaPosition;
  readonly application: SchemaPosition;
};

export type Deferral =
  | { readonly _tag: 'OfferUnproved'; readonly refusal: ArtifactFailure }
  | { readonly _tag: 'RegistrationUnusable'; readonly refusal: RegistrationReadFailure }
  | { readonly _tag: 'HostUnknown'; readonly reason: string }
  | { readonly _tag: 'BundleMismatch'; readonly standing: Digest; readonly offered: Digest }
  | { readonly _tag: 'BootUnusable'; readonly detail: string }
  | { readonly _tag: 'BootMismatch' }
  | { readonly _tag: 'SchemaAhead'; readonly database: SchemaPosition; readonly application: SchemaPosition }
  | { readonly _tag: 'SchemaDiverged'; readonly database: SchemaPosition; readonly application: SchemaPosition };

export type Adoption =
  | { readonly _tag: 'Adopt'; readonly standing: Registration; readonly offered: ArtifactManifest }
  | { readonly _tag: 'Defer'; readonly reason: Deferral };

const defer = (reason: Deferral): Adoption => ({ _tag: 'Defer', reason });

const unserved = (schema: SchemaOffer): Deferral | undefined => {
  const { database, application } = schema;
  if (database.applied > application.applied) return { _tag: 'SchemaAhead', database, application };
  if (database.applied === application.applied && database.latest !== application.latest) {
    return { _tag: 'SchemaDiverged', database, application };
  }
  return undefined;
};

const readBoot = Schema.decodeUnknownEffect(Schema.fromJsonString(HostBootFile));

export type HostActivation = Effect.Success<typeof makeHostActivation>;

export const makeHostActivation = Effect.gen(function* () {
  const registration = yield* HostRegistration;
  const files = yield* FileSystem.FileSystem;
  return {
    adoption: Effect.fn('HostActivation.adoption')(function* (
      bundle: string,
      state: string,
      schema: SchemaOffer,
      declared: ExecutionPolicy,
      digest: Digest,
      lifetime?: HostLifetime,
    ): Effect.fn.Return<Adoption> {
      const manifest = yield* Effect.result(Effect.provideService(readArtifact(bundle), FileSystem.FileSystem, files));
      if (manifest._tag === 'Failure') return defer({ _tag: 'OfferUnproved', refusal: manifest.failure });
      const standing = yield* Effect.result(registration.read(state));
      if (standing._tag === 'Failure') return defer({ _tag: 'RegistrationUnusable', refusal: standing.failure });
      const proved =
        standing.success.artifact?.identity.digest === manifest.success.identity.digest
          ? manifest
          : yield* Effect.result(Effect.provideService(verifyArtifact(bundle), FileSystem.FileSystem, files));
      if (proved._tag === 'Failure') return defer({ _tag: 'OfferUnproved', refusal: proved.failure });
      const published = standing.success.artifact?.identity.digest;
      if (published === undefined) return defer({ _tag: 'HostUnknown', reason: 'the host recorded no bundle identity' });
      if (published !== proved.success.identity.digest) {
        return defer({ _tag: 'BundleMismatch', standing: published, offered: proved.success.identity.digest });
      }
      if (published !== digest) return defer({ _tag: 'BundleMismatch', standing: published, offered: digest });
      const database = unserved(schema);
      if (database !== undefined) return defer(database);
      const given = bootInput(state, standing.success, proved.success, declared, lifetime);
      if (given === undefined) return defer({ _tag: 'BootUnusable', detail: 'the bundle names no platform library' });
      const loaded = yield* Effect.result(files.readFileString(bootPath(state, published)).pipe(Effect.flatMap(readBoot)));
      if (loaded._tag === 'Failure') return defer({ _tag: 'BootUnusable', detail: loaded.failure.message });
      if (bootText(loaded.success) !== bootText(given)) return defer({ _tag: 'BootMismatch' });
      return { _tag: 'Adopt', standing: standing.success, offered: proved.success };
    }),
  };
});
