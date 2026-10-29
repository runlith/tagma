import { Context, Data, Effect, FileSystem, Layer, Path, type PlatformError, Schema } from 'effect';
import type { ArtifactStamp } from './protocol/artifact';
import type { ProcessWitness } from './protocol/evidence';
import { REGISTRATION_FILE, Registration, RegistrationIdentity, sameIdentity } from './protocol/registration';

export class RegistrationMissing extends Data.TaggedError('RegistrationMissing')<{
  readonly state: string;
}> {
  override get message(): string {
    return `no host registration stands at ${this.state}`;
  }
}

export class RegistrationInvalid extends Data.TaggedError('RegistrationInvalid')<{
  readonly state: string;
  readonly reason: 'schema' | 'mismatch';
  readonly detail: string;
  readonly named?: string;
}> {
  override get message(): string {
    return `the host registration at ${this.state} is invalid (${this.reason}): ${this.detail}`;
  }
}

export class RegistrationConflict extends Data.TaggedError('RegistrationConflict')<{
  readonly state: string;
  readonly standing: Registration;
  readonly offered: RegistrationIdentity;
}> {
  override get message(): string {
    return `the host registration at ${this.state} names another host (installation ${this.standing.installation}, protocol ${this.standing.protocol})`;
  }
}

export class RegistrationFailed extends Data.TaggedError('RegistrationFailed')<{
  readonly state: string;
  readonly act: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `the host registration at ${this.state}: ${this.act} failed: ${this.detail}`;
  }
}

export type Publication =
  | { readonly _tag: 'Published'; readonly registration: Registration }
  | { readonly _tag: 'Existing'; readonly registration: Registration };

export type RegistrationReadFailure = RegistrationMissing | RegistrationInvalid | RegistrationFailed;

const codec = Schema.fromJsonString(Registration, { space: 2 });
const decode = Schema.decodeUnknownEffect(codec);
const encode = Schema.encodeEffect(codec);

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const reason = (error: PlatformError.PlatformError) => error.reason._tag;

  const failed =
    (state: string, act: string) =>
    <A, R>(self: Effect.Effect<A, PlatformError.PlatformError, R>): Effect.Effect<A, RegistrationFailed, R> =>
      Effect.catchTag(self, 'PlatformError', (error) => Effect.fail(new RegistrationFailed({ state, act, detail: error.message })));

  const readAt = Effect.fn('HostRegistration.readAt')(function* (canonical: string) {
    const text = yield* fs
      .readFileString(path.join(canonical, REGISTRATION_FILE))
      .pipe(
        Effect.catchTag('PlatformError', (error) =>
          Effect.fail(
            reason(error) === 'NotFound'
              ? new RegistrationMissing({ state: canonical })
              : new RegistrationFailed({ state: canonical, act: 'read', detail: error.message }),
          ),
        ),
      );
    const registration = yield* decode(text).pipe(
      Effect.catchTag('SchemaError', (error) =>
        Effect.fail(new RegistrationInvalid({ state: canonical, reason: 'schema', detail: error.message })),
      ),
    );
    if (registration.state !== canonical) {
      return yield* new RegistrationInvalid({
        state: canonical,
        reason: 'mismatch',
        detail: `the registration names ${registration.state}`,
        named: registration.state,
      });
    }
    return registration;
  });

  const place = Effect.fn('HostRegistration.place')(
    function* (canonical: string, text: string) {
      const target = path.join(canonical, REGISTRATION_FILE);
      const draft = path.join(canonical, `${REGISTRATION_FILE}.${yield* Effect.sync(() => crypto.randomUUID())}`);
      return yield* fs.writeFileString(draft, text, { flag: 'wx', mode: 0o600 }).pipe(
        Effect.andThen(
          fs.link(draft, target).pipe(
            Effect.as(true),
            Effect.catchIf(
              (error) => reason(error) === 'AlreadyExists',
              () => Effect.succeed(false),
            ),
          ),
        ),
        Effect.ensuring(Effect.ignore(fs.remove(draft))),
      );
    },
    (effect, canonical) => effect.pipe(failed(canonical, 'publish')),
  );

  return HostRegistration.of({
    read: (state) =>
      fs.realPath(state).pipe(
        Effect.catchTag('PlatformError', (error) =>
          Effect.fail(
            reason(error) === 'NotFound'
              ? new RegistrationMissing({ state })
              : new RegistrationFailed({ state, act: 'resolve', detail: error.message }),
          ),
        ),
        Effect.flatMap(readAt),
      ),

    record: Effect.fn('HostRegistration.record')(function* (state, artifact, logic) {
      const canonical = yield* fs.realPath(state).pipe(failed(state, 'resolve'));
      const standing = yield* readAt(canonical);
      if (
        standing.artifact?.identity.digest === artifact.identity.digest &&
        standing.logic?.pid === logic.pid &&
        standing.logic.birth === logic.birth
      ) {
        return standing;
      }
      const recorded: Registration = { ...standing, artifact, logic };
      const text = yield* encode(recorded).pipe(
        Effect.catchTag('SchemaError', (error) =>
          Effect.fail(new RegistrationInvalid({ state: canonical, reason: 'schema', detail: error.message })),
        ),
      );
      const draft = path.join(canonical, `${REGISTRATION_FILE}.${yield* Effect.sync(() => crypto.randomUUID())}`);
      yield* fs
        .writeFileString(draft, text, { flag: 'wx', mode: 0o600 })
        .pipe(
          Effect.andThen(fs.rename(draft, path.join(canonical, REGISTRATION_FILE))),
          Effect.ensuring(Effect.ignore(fs.remove(draft))),
          failed(canonical, 'record'),
        );
      return recorded;
    }),

    withdraw: Effect.fn('HostRegistration.withdraw')(function* (registration) {
      const standing = yield* readAt(registration.state).pipe(Effect.catchTag('RegistrationMissing', () => Effect.succeed(undefined)));
      if (standing === undefined) return;
      if (!sameIdentity(standing, registration))
        return yield* new RegistrationConflict({ state: registration.state, standing, offered: registration });
      yield* fs.remove(path.join(registration.state, REGISTRATION_FILE)).pipe(failed(registration.state, 'withdraw'));
    }),

    publish: Effect.fn('HostRegistration.publish')(function* (state, identity) {
      yield* fs.makeDirectory(state, { recursive: true, mode: 0o700 }).pipe(failed(state, 'makeDirectory'));
      const canonical = yield* fs.realPath(state).pipe(failed(state, 'resolve'));
      const registration: Registration = { version: 1, state: canonical, ...identity };
      const text = yield* encode(registration).pipe(
        Effect.catchTag('SchemaError', (error) =>
          Effect.fail(new RegistrationInvalid({ state: canonical, reason: 'schema', detail: error.message })),
        ),
      );
      if (yield* place(canonical, text)) return { _tag: 'Published', registration } satisfies Publication;
      const standing = yield* readAt(canonical);
      if (sameIdentity(standing, identity)) return { _tag: 'Existing', registration: standing } satisfies Publication;
      return yield* new RegistrationConflict({ state: canonical, standing, offered: identity });
    }),
  });
});

export class HostRegistration extends Context.Service<
  HostRegistration,
  {
    readonly read: (state: string) => Effect.Effect<Registration, RegistrationReadFailure>;
    readonly publish: (
      state: string,
      identity: RegistrationIdentity,
    ) => Effect.Effect<Publication, RegistrationReadFailure | RegistrationConflict>;
    readonly record: (
      state: string,
      artifact: ArtifactStamp,
      logic: ProcessWitness,
    ) => Effect.Effect<Registration, RegistrationReadFailure | RegistrationInvalid>;
    readonly withdraw: (registration: Registration) => Effect.Effect<void, RegistrationReadFailure | RegistrationConflict>;
  }
>()('@runlith/executions/HostRegistration') {
  static readonly layer = Layer.effect(HostRegistration, make);
}
