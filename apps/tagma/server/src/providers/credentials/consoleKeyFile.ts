import { join } from 'node:path';
import { flushFile } from '../../platform/durable/files.js';
import { type CredentialFile, makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileFailed, type CredentialFileFault, CredentialFileInvalid } from '@runlith/credential-file/failure';
import { Effect, Schema } from 'effect';

export const CONSOLE_KEYS_FILE = 'console-keys.json';

export type ConsoleKeyDocument = {
  readonly version: 1;
  readonly keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

const documentSchema = Schema.Struct({
  version: Schema.Literal(1),
  keys: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
});

const decodeConsoleKeys = (path: string, parsed: unknown) =>
  Schema.decodeUnknownEffect(documentSchema)(parsed).pipe(
    Effect.map((value) => ({ value, needsWrite: false })),
    Effect.mapError((error) => new CredentialFileInvalid({ path, reason: error.message })),
  );

export type ConsoleKeyFile = CredentialFile<ConsoleKeyDocument> & { readonly directory: string };

export const consoleKeyFile = (directory: string): ConsoleKeyFile =>
  Object.assign(
    makeCredentialFile<ConsoleKeyDocument>({
      path: join(directory, CONSOLE_KEYS_FILE),
      codec: {
        empty: () => ({ version: 1, keys: {} }),
        decode: decodeConsoleKeys,
      },
    }),
    { directory },
  );

export type KeptKey = { readonly provider: string; readonly account: string; readonly keyValue: string };

const keysFailed = (reason: string) => new CredentialFileFailed({ kind: 'write', reason });

export const keepDurably = Effect.fn('providers.keepDurably')(function* (file: ConsoleKeyFile, kept: readonly KeptKey[]) {
  const { directory } = file;
  if (kept.length === 0) return;
  yield* file.update((current) =>
    Effect.succeed(kept.reduce((document, key) => withKey(document, key.provider, key.account, key.keyValue), current)),
  );
  const written = yield* file.readFresh();
  const missing = kept.filter((key) => written.keys[key.provider]?.[key.account] !== key.keyValue);
  if (missing.length > 0) {
    return yield* keysFailed(
      `${join(directory, CONSOLE_KEYS_FILE)} does not hold ${missing.map((key) => `${key.provider}/${key.account}`).join(', ')} after its write`,
    );
  }
  const path = join(directory, CONSOLE_KEYS_FILE);
  const durability = yield* Effect.mapError(flushFile(path), (failure) =>
    keysFailed(`${path} could not be flushed after its console keys were written: ${failure.reason}`),
  );
  if (durability !== 'full') {
    return yield* keysFailed(`${path} was flushed only ${durability}, so the keys it holds may not survive a power loss`);
  }
});

export const withKey = (document: ConsoleKeyDocument, provider: string, account: string, keyValue: string | null): ConsoleKeyDocument => {
  const { [account]: _dropped, ...others } = document.keys[provider] ?? {};
  const accounts = keyValue === null ? others : { ...others, [account]: keyValue };
  return { version: 1, keys: { ...document.keys, [provider]: accounts } };
};
