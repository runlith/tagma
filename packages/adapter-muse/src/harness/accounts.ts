import { join } from 'node:path';
import { Data, Effect, Schema } from 'effect';
import type { HarnessAccountAuth, HarnessOutput } from '@runlith/tagma/adapter/provider';

class AccountUnreadable extends Data.TaggedError('AccountUnreadable')<{ readonly message: string }> {}

const VERSION = /Muse Code (\d+\.\d+\.\d+)/u;

const Login = Schema.fromJsonString(
  Schema.Struct({
    providers: Schema.Struct({
      meta: Schema.optional(
        Schema.Struct({
          mechanism: Schema.optional(Schema.String),
          user_full_name: Schema.optional(Schema.String),
          user_email: Schema.optional(Schema.String),
        }),
      ),
    }),
  }),
);

const loginPath = (env: Readonly<Record<string, string | undefined>>): string | null => {
  const home = env.HOME || env.USERPROFILE;
  const config = env.XDG_CONFIG_HOME || (home ? join(home, '.config') : null);
  return config === null ? null : join(config, 'muse', 'auth.json');
};

const loggedIn = Effect.fnUntraced(function* (output: HarnessOutput) {
  if (output.code !== 0)
    return yield* new AccountUnreadable({ message: `muse --version exited ${output.code}: ${(output.stderr || output.stdout).trim()}` });
  const version = VERSION.exec(output.stdout)?.[1];
  const path = loginPath(process.env);
  if (path === null)
    return yield* new AccountUnreadable({ message: 'HOME and USERPROFILE name no home directory, so the Muse login cannot be read' });
  const file = Bun.file(path);
  if (!(yield* Effect.promise(() => file.exists()))) return null;
  const text = yield* Effect.tryPromise({
    try: () => file.text(),
    catch: (cause) => new AccountUnreadable({ message: `The Muse login record ${path} could not be read: ${String(cause)}` }),
  });
  const login = yield* Schema.decodeUnknownEffect(Login)(text).pipe(
    Effect.mapError((cause) => new AccountUnreadable({ message: `The Muse login record ${path} is unreadable: ${cause.message}` })),
  );
  const meta = login.providers.meta;
  if (meta === undefined) return null;
  const who = meta.user_full_name ?? meta.user_email ?? 'Meta account';
  return { label: version === undefined ? who : `${who} · Muse Code ${version}` };
});

export const accounts: HarnessAccountAuth = {
  directory: 'muse-code',
  login: { program: 'muse', args: ['login'] },
  status: { program: 'muse', args: ['--version'] },
  loggedIn,
};
