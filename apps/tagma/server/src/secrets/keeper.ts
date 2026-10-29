import type { CredentialFile } from '@runlith/credential-file/CredentialFile';
import { makeRefreshFlight, type RefreshFlightFault, type RefreshRequest } from '@runlith/credential-file/RefreshFlight';
import { Data, Effect } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import {
  type SecretEntry,
  type SecretHolder,
  type SecretOwner,
  SecretOwnerFailed,
  SecretOwners,
  Secrets,
  SecretStoreFailed,
  type SecretTarget,
  type SignInRefresh,
} from './contract/service/secrets.js';
import { SECRET_VALUE_MAX, type SecretRow, type SecretSet } from './contract/wire/rows.js';
import { adopted, dropped, EMPTY, type Held, put, signInOf, valuesOf, withSignIn, without } from './store.js';

const storeFailed = () => new SecretStoreFailed({ message: 'the secret store could not be read or written' });

class Carried<E> extends Data.TaggedError('Carried')<{ readonly failure: E }> {}

const carried = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Carried<E>, R> =>
  Effect.mapError(effect, (failure) => new Carried({ failure }));

const uncarried = <E>(error: Carried<E> | RefreshFlightFault): E | SecretStoreFailed =>
  error._tag === 'Carried' ? error.failure : storeFailed();
const unreadable = () =>
  new GateRefusal('secret-store-failed', 'The secret store could not be read or written.', [
    'make the file secrets.json in the server’s data directory readable and writable to the server, then repeat',
  ]);
const unavailable = () =>
  new GateRefusal('secret-store-unavailable', 'This server keeps no data directory, so it has nowhere to keep a secret.', [
    'run the server with a data directory',
  ]);
const ownerFailed = (failure: SecretOwnerFailed) => new GateRefusal('secret-owner-failed', failure.reason, failure.unblock);
const invalid = (reason: string) =>
  new GateRefusal('secret-value-invalid', reason, [`give a non-empty value of at most ${SECRET_VALUE_MAX} characters without a NUL`]);

const maskedForms = (value: string): readonly string[] => {
  const escaped = JSON.stringify(value).slice(1, -1);
  return escaped === value ? [value] : [value, escaped];
};

const rowOf = (entry: SecretEntry, set: boolean): SecretRow => ({ name: entry.name, description: entry.description, set });

export const makeKeeper = (input: { readonly file: CredentialFile<Held> | null }) => {
  const { file } = input;
  const kinds = new Map<string, SecretOwner>();
  const refreshes =
    file === null
      ? null
      : makeRefreshFlight({ file, name: 'secret-sign-in-refresh', owner: 'secrets', span: 'SecretOwners.refreshSignIn' });

  const keepSignIn = <E>(
    kind: string,
    key: string,
    change: (signIn: unknown) => Effect.Effect<unknown, E>,
  ): Effect.Effect<void, E | SecretStoreFailed> =>
    file === null
      ? Effect.fail(storeFailed())
      : file
          .update((current) =>
            carried(change(signInOf(current, kind, key))).pipe(
              Effect.map((next) =>
                JSON.stringify(next) === JSON.stringify(signInOf(current, kind, key)) ? current : withSignIn(current, kind, key, next),
              ),
            ),
          )
          .pipe(Effect.mapError(uncarried<E>), Effect.withSpan('SecretOwners.keepSignIn'));

  const refreshSignIn = <Grant, E, R>(
    kind: string,
    key: string,
    request: SignInRefresh<Grant, E, R>,
  ): Effect.Effect<void, E | SecretStoreFailed, R> => {
    if (refreshes === null) return Effect.fail(storeFailed());
    const prepared: RefreshRequest<Held, Grant, Carried<E>, R> = {
      grant: (document, stage) => carried(request.grant(signInOf(document, kind, key), stage)),
      identity: request.identity,
      needed: (grant) => carried(request.needed(grant)),
      refresh: (grant) => carried(request.refresh(grant)),
      replace: (document, grant) =>
        Effect.map(carried(request.replace(signInOf(document, kind, key), grant)), (next) => withSignIn(document, kind, key, next)),
    };
    return refreshes.run(`${kind}/${key}`, Effect.succeed(prepared)).pipe(Effect.mapError(uncarried<E>));
  };

  const held = (): Effect.Effect<Held, SecretStoreFailed> =>
    file === null ? Effect.succeed(EMPTY) : file.read().pipe(Effect.mapError(storeFailed));

  const change = Effect.fn('Secrets.change')(function* (step: (current: Held) => Held) {
    if (file === null) return false;
    let changed = false;
    yield* file
      .update((current) => {
        const next = step(current);
        changed = next !== current;
        return Effect.succeed(next);
      })
      .pipe(Effect.mapError(storeFailed));
    return changed;
  });

  const kindOf = (owner: string) => {
    const kind = kinds.get(owner);
    return kind === undefined
      ? Effect.fail(
          new GateRefusal('secret-owner-unknown', `No owner of the kind ${owner} keeps secrets on this server.`, [
            `name one of the kinds that keep secrets: ${[...kinds.keys()].sort().join(', ') || 'none is registered'}`,
          ]),
        )
      : Effect.succeed(kind);
  };

  const holderOf = Effect.fnUntraced(function* (projectId: number, target: SecretTarget) {
    const kind = yield* kindOf(target.owner);
    const holders = yield* kind.holders(projectId).pipe(Effect.mapError(ownerFailed));
    const holder = holders.find((candidate) => candidate.id === target.id);
    if (holder === undefined)
      return yield* new GateRefusal('secret-owner-unknown', `No ${target.owner} ${target.id} keeps secrets in this project.`, [
        `read_secrets with owner ${target.owner} names the owners that do`,
      ]);
    return { kind, holder };
  });

  const unknown = (target: SecretTarget) =>
    new GateRefusal('secret-unknown', `${target.owner} ${target.id} declares no secret ${target.name}.`, [
      `read_secrets with owner ${target.owner} and id ${target.id} names what it declares`,
    ]);

  const notify = Effect.fnUntraced(
    function* (kind: SecretOwner, holder: SecretHolder, written: Effect.Effect<boolean, SecretStoreFailed>) {
      if (yield* written.pipe(Effect.mapError(unreadable))) yield* kind.changed(holder.key).pipe(Effect.mapError(ownerFailed));
    },
    (effect) => Effect.uninterruptible(effect),
  );

  const setOf = (kind: string, holder: SecretHolder, kept: Held): SecretSet => {
    const values = valuesOf(kept, kind, holder.key);
    const secrets = holder.entries.map((entry) => rowOf(entry, (values[entry.name] ?? '') !== ''));
    return { owner: kind, id: holder.id, title: holder.title, secrets, missing: secrets.filter((secret) => !secret.set).length };
  };

  const secrets = Secrets.of({
    read: Effect.fn('Secrets.read')(function* (projectId, owner, id) {
      const kind = yield* kindOf(owner);
      const holders = yield* kind.holders(projectId).pipe(Effect.mapError(ownerFailed));
      const kept = yield* held().pipe(Effect.mapError(unreadable));
      return holders
        .filter((holder) => holder.entries.length > 0 && (id === undefined || holder.id === id))
        .map((holder) => setOf(owner, holder, kept));
    }),
    set: Effect.fn('Secrets.set')(function* (projectId, target, value) {
      const { kind, holder } = yield* holderOf(projectId, target);
      const entry = holder.entries.find((candidate) => candidate.name === target.name);
      if (entry === undefined) return yield* unknown(target);
      if (value === '') return yield* invalid('A secret takes a value; to take its value away, remove it.');
      if (value.length > SECRET_VALUE_MAX) return yield* invalid(`A secret value takes at most ${SECRET_VALUE_MAX} characters.`);
      if (value.includes('\0')) return yield* invalid('A secret value cannot hold a NUL character.');
      if (file === null) return yield* unavailable();
      yield* notify(
        kind,
        holder,
        change((current) => put(current, kind.kind, holder.key, target.name, value)),
      );
      return rowOf(entry, true);
    }),
    remove: Effect.fn('Secrets.remove')(function* (projectId, target) {
      if (file === null) return yield* unavailable();
      const { kind, holder } = yield* holderOf(projectId, target);
      const entry = holder.entries.find((candidate) => candidate.name === target.name);
      const kept = valuesOf(yield* held().pipe(Effect.mapError(unreadable)), kind.kind, holder.key)[target.name] !== undefined;
      if (entry === undefined && !kept) return yield* unknown(target);
      yield* notify(
        kind,
        holder,
        change((current) => without(current, kind.kind, holder.key, target.name)),
      );
      return { name: target.name, description: entry?.description ?? '', set: false };
    }),
  });

  const owners = SecretOwners.of({
    register: (owner) =>
      Effect.sync(() => {
        kinds.set(owner.kind, owner);
        return () => {
          if (kinds.get(owner.kind) === owner) kinds.delete(owner.kind);
        };
      }),
    handout: Effect.fn('SecretOwners.handout')(function* (kind) {
      const kept = yield* held();
      return (key) => {
        const values = valuesOf(kept, kind, key);
        return { values, redact: Object.values(values).flatMap(maskedForms), signIn: signInOf(kept, kind, key) };
      };
    }),
    keepSignIn,
    refreshSignIn,
    drop: Effect.fn('SecretOwners.drop')(function* (kind, key) {
      yield* change((current) => dropped(current, kind, key));
    }),
    adopt: Effect.fn('SecretOwners.adopt')(function* (kind, given) {
      if (file === null) return yield* new SecretStoreFailed({ message: 'this server keeps no data directory to move secrets into' });
      yield* change((current) => adopted(current, kind, given));
    }),
  });

  return { secrets, owners };
};
