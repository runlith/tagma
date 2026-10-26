import { Effect, Schema } from 'effect';
import type { HarnessAccountAuth, HarnessIdentity, HarnessOutput } from '@runlith/tagma/adapter/provider';

const SUBSCRIPTION = 'claude.ai';

const AuthStatus = Schema.Struct({
  loggedIn: Schema.Boolean,
  authMethod: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  orgName: Schema.optional(Schema.NullOr(Schema.String)),
});

const decodeStatus = Schema.decodeUnknownEffect(Schema.fromJsonString(AuthStatus));

function loggedIn(output: HarnessOutput): Effect.Effect<HarnessIdentity | null, { readonly message: string }> {
  return decodeStatus(output.stdout.trim()).pipe(
    Effect.mapError(() => ({
      message: `claude auth status answered something unreadable: ${output.stdout.trim() || output.stderr.trim()}`,
    })),
    Effect.flatMap((status) => {
      if (!status.loggedIn) return Effect.succeed(null);
      if (status.authMethod !== SUBSCRIPTION) {
        return Effect.fail({
          message: `Claude Code is signed in with ${status.authMethod ?? 'an unknown method'}, not a Claude subscription`,
        });
      }
      return Effect.succeed({ label: status.email ?? status.orgName ?? 'Claude' });
    }),
  );
}

export const claudeAccounts: HarnessAccountAuth = {
  directory: 'claude',
  login: { program: 'claude', args: ['auth', 'login'] },
  status: { program: 'claude', args: ['auth', 'status', '--json'] },
  loggedIn,
  renew: { program: 'claude', args: ['-p', '/usage'] },
};
