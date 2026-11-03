import { homedir } from 'node:os';
import { Effect, Schema } from 'effect';
import type { HarnessAccountAuth, HarnessLoginStatus, HarnessOutput } from '@runlith/tagma/adapter/provider';

const SUBSCRIPTION = 'claude.ai';

const AuthStatus = Schema.Struct({
  loggedIn: Schema.Boolean,
  authMethod: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  orgName: Schema.optional(Schema.NullOr(Schema.String)),
});

const decodeStatus = Schema.decodeUnknownEffect(Schema.fromJsonString(AuthStatus));

function loggedIn(output: HarnessOutput): Effect.Effect<HarnessLoginStatus> {
  const unreadable = (): HarnessLoginStatus => ({
    kind: 'unreadable',
    reason: `claude auth status answered something unreadable: ${output.stderr.trim() || output.stdout.trim() || `exit ${output.code}`}`,
  });
  return decodeStatus(output.stdout.trim()).pipe(
    Effect.match({
      onFailure: unreadable,
      onSuccess: (status): HarnessLoginStatus => {
        if (!status.loggedIn) return { kind: 'signed-out' };
        if (output.code !== 0) return unreadable();
        if (status.authMethod !== SUBSCRIPTION) return { kind: 'unsupported-method', method: status.authMethod ?? 'an unknown method' };
        return { kind: 'signed-in', label: status.email ?? status.orgName ?? 'Claude' };
      },
    }),
  );
}

export const claudeAccounts: HarnessAccountAuth = {
  directory: 'claude',
  login: { program: 'claude', args: ['auth', 'login'] },
  status: { program: 'claude', args: ['auth', 'status', '--json'] },
  loggedIn,
  discovery: { variable: 'CLAUDE_CONFIG_DIR', directory: homedir(), files: ['.claude.json'] },
  renew: { program: 'claude', args: ['-p', '/usage'] },
};
