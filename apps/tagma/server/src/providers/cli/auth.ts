import { AccountKey } from '@runlith/llm/models/authStatus';
import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { CurrentInvocation, print, type Invocation } from '../../platform/cli/verb.js';
import { PROVIDER_OPERATIONS as OPS } from '../contract/wire/operations.js';

export type AuthCli = {
  readonly perform: Perform;
  readonly here: (at: Invocation) => DoorLens;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));

export const auth = ({ perform, here }: AuthCli) => {
  const aimed = Effect.map(CurrentInvocation, here);
  const authSignIn = Command.make(
    'auth',
    {
      json,
      provider: Argument.String('provider'),
      method: Flag.Literals('method', ['loopback', 'device', 'paste', 'key', 'external-cli']).pipe(Flag.optional),
    },
    Effect.fnUntraced(function* ({ json, provider, method }) {
      const { signIn } = yield* Effect.promise(() => import('./signIn.js'));
      const stored = yield* signIn(perform, yield* aimed, provider.trim(), Option.getOrUndefined(method));
      if (json) return yield* print(stored, true);
      yield* Console.log(
        `signed into ${stored.provider}; access token ${stored.expiresAt === null ? 'no expiry' : `valid until ${new Date(stored.expiresAt).toISOString()}`}`,
      );
    }),
  ).pipe(Command.withDescription('add an account through its subscription OAuth flow'));

  const authRemove = Command.make(
    'remove',
    {
      json,
      provider: Argument.String('provider'),
      account: Argument.String('account'),
    },
    Effect.fnUntraced(function* ({ json, provider, account }) {
      const { removed } = yield* perform(OPS.remove_account, { provider, account: AccountKey.make(account) }, yield* aimed);
      if (json) return yield* print(removed, true);
      yield* Console.log(`removed ${removed.provider} account ${removed.removed}; default ${removed.default ?? 'none'}`);
    }),
  ).pipe(Command.withDescription('remove one stored subscription account'));

  const authLabel = Command.make(
    'label',
    {
      json,
      provider: Argument.String('provider'),
      account: Argument.String('account'),
      label: Argument.String('label'),
    },
    Effect.fnUntraced(function* ({ json, provider, account, label }) {
      const { account: relabelled } = yield* perform(
        OPS.rename_account,
        { provider, account: AccountKey.make(account), label },
        yield* aimed,
      );
      if (json) return yield* print(relabelled, true);
      yield* Console.log(`${relabelled.provider} account ${relabelled.account} labelled ${relabelled.label}`);
    }),
  ).pipe(Command.withDescription('replace one account label'));

  return authSignIn.pipe(Command.withSubcommands([authRemove, authLabel]));
};
