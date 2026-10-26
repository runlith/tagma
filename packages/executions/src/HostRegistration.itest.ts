import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { HostRegistration } from './HostRegistration';
import { REGISTRATION_FILE, RegistrationIdentity } from './protocol/registration';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const identity = (name: string) =>
  Schema.decodeUnknownEffect(RegistrationIdentity)({
    installation: name,
    protocol: 'executions/1',
    endpoint: { transport: 'unix', path: `/tmp/${name}.sock` },
    credentials: { custodian: `/keys/${name}/custodian`, recovery: `/keys/${name}/recovery` },
  });

const stateDirectory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'registration-' });
  return path.join(root, 'state');
});

layer(HostRegistration.layer.pipe(Layer.provideMerge(platform)), { excludeTestServices: true })('HostRegistration', (it) => {
  it.effect('racing publishers of one identity share one registration, placed once', () =>
    Effect.gen(function* () {
      const registrations = yield* HostRegistration;
      const state = yield* stateDirectory;
      const offered = yield* identity('one');
      const [a, b] = yield* Effect.all([registrations.publish(state, offered), registrations.publish(state, offered)], {
        concurrency: 2,
      });
      const standing = yield* registrations.read(state);
      expect([a._tag, b._tag].sort()).toEqual(['Existing', 'Published']);
      expect(a.registration).toEqual(b.registration);
      expect(standing).toEqual(a.registration);
      expect(String(standing.installation)).toBe('one');
    }),
  );

  it.effect('a different identity loses to the registration that stands and changes nothing', () =>
    Effect.gen(function* () {
      const registrations = yield* HostRegistration;
      const state = yield* stateDirectory;
      const first = yield* registrations.publish(state, yield* identity('one'));
      const refusal = yield* Effect.flip(registrations.publish(state, yield* identity('two')));
      const standing = yield* registrations.read(state);
      expect(refusal._tag).toBe('RegistrationConflict');
      if (refusal._tag !== 'RegistrationConflict') return;
      expect(refusal.standing).toEqual(first.registration);
      expect(String(refusal.offered.installation)).toBe('two');
      expect(standing).toEqual(first.registration);
    }),
  );

  it.effect('withdrawal preserves another identity and removes its own registration idempotently', () =>
    Effect.gen(function* () {
      const registrations = yield* HostRegistration;
      const state = yield* stateDirectory;
      const published = yield* registrations.publish(state, yield* identity('one'));
      const other = yield* identity('two');
      const refused = yield* Effect.flip(registrations.withdraw({ ...published.registration, installation: other.installation }));
      const kept = yield* registrations.read(state);
      yield* registrations.withdraw(published.registration);
      yield* registrations.withdraw(published.registration);
      const missing = yield* Effect.flip(registrations.read(state));
      expect(refused._tag).toBe('RegistrationConflict');
      expect(kept).toEqual(published.registration);
      expect(missing._tag).toBe('RegistrationMissing');
    }),
  );

  it.effect('an alias reads the canonical registration; a copy elsewhere refuses as a mismatch', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const registrations = yield* HostRegistration;
      const state = yield* stateDirectory;
      const published = yield* registrations.publish(state, yield* identity('one'));
      const alias = path.join(path.dirname(state), 'alias');
      yield* fs.symlink(state, alias);
      const throughAlias = yield* registrations.read(alias);
      const elsewhere = path.join(path.dirname(state), 'elsewhere');
      yield* fs.makeDirectory(elsewhere);
      yield* fs.copyFile(path.join(state, REGISTRATION_FILE), path.join(elsewhere, REGISTRATION_FILE));
      const mismatch = yield* Effect.flip(registrations.read(elsewhere));
      const missing = yield* Effect.flip(registrations.read(path.join(path.dirname(state), 'absent')));
      expect(throughAlias).toEqual(published.registration);
      expect(throughAlias.state).toBe(published.registration.state);
      expect(mismatch._tag).toBe('RegistrationInvalid');
      if (mismatch._tag !== 'RegistrationInvalid') return;
      expect(mismatch.reason).toBe('mismatch');
      expect(mismatch.named).toBe(published.registration.state);
      expect(missing._tag).toBe('RegistrationMissing');
    }),
  );
});
