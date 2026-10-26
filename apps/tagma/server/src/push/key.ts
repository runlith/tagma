import { createECDH } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Data, Effect, Schema } from 'effect';
import type { Vapid } from './contract/service/sender.js';

const SUBJECT = 'mailto:push@tagma.example.com';

const KeyFile = Schema.fromJsonString(Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String }));

export class KeyUnreadable extends Data.TaggedError('KeyUnreadable')<{ readonly reason: string }> {}

const minted = () => {
  const curve = createECDH('prime256v1');
  curve.generateKeys();
  return { publicKey: curve.getPublicKey('base64url'), privateKey: curve.getPrivateKey('base64url') };
};

const absent = (cause: unknown): boolean => (cause as NodeJS.ErrnoException | null)?.code === 'ENOENT';

const born = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      const keys = minted();
      await writeFile(path, JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
      return keys;
    },
    catch: (cause) => cause,
  });

const read = (path: string) =>
  Effect.flatMap(Effect.tryPromise({ try: () => readFile(path, 'utf8'), catch: (cause) => cause }), (text) =>
    Effect.mapError(
      Schema.decodeUnknownEffect(KeyFile)(text),
      (issue) => new KeyUnreadable({ reason: `${path} is not a push key: ${issue.message}` }),
    ),
  );

export const vapidAt = Effect.fn('push.vapidAt')((path: string | null): Effect.Effect<Vapid, KeyUnreadable> => {
  if (path === null) return Effect.succeed({ ...minted(), subject: SUBJECT });
  const unreadable = (cause: unknown) => new KeyUnreadable({ reason: `${path} cannot be read: ${String(cause)}` });
  return read(path).pipe(
    Effect.catchIf(
      (cause) => !(cause instanceof KeyUnreadable) && absent(cause),
      () =>
        born(path).pipe(
          Effect.catchIf(
            (cause) => (cause as NodeJS.ErrnoException | null)?.code === 'EEXIST',
            () => read(path),
          ),
        ),
    ),
    Effect.mapError((cause) => (cause instanceof KeyUnreadable ? cause : unreadable(cause))),
    Effect.map((keys) => ({ ...keys, subject: SUBJECT })),
  );
});
