import { Effect, Schema } from 'effect';
import type { HarnessAccountAuth, HarnessIdentity, HarnessOutput } from '@runlith/tagma/adapter/provider';

const SUBSCRIPTION = 'Logged in using ChatGPT';
const SIGNED_OUT = 'Not logged in';

function loggedIn(output: HarnessOutput): Effect.Effect<HarnessIdentity | null, { readonly message: string }> {
  const said = `${output.stdout}\n${output.stderr}`.trim();
  if (said.includes(SUBSCRIPTION)) return Effect.succeed({ label: 'ChatGPT' });
  if (said.includes(SIGNED_OUT)) return Effect.succeed(null);
  return Effect.fail({ message: `Codex is not signed in with a ChatGPT subscription: ${said || `exit ${output.code}`}` });
}

const RenewalReply = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
});

const renewalComplete = (line: string): boolean => {
  const reply = Schema.decodeUnknownSync(RenewalReply)(JSON.parse(line));
  if (reply.id !== 2) return false;
  if (reply.error !== undefined) throw new Error(reply.error.message);
  return true;
};

export const codexAccounts: HarnessAccountAuth = {
  directory: 'codex',
  login: { program: 'codex', args: ['login'] },
  status: { program: 'codex', args: ['login', 'status'] },
  renew: {
    program: 'codex',
    args: ['app-server', '-c', 'cli_auth_credentials_store="file"', '-c', 'analytics.enabled=false', '-c', 'otel.exporter="none"'],
    exchange: {
      input:
        [
          { id: 1, method: 'initialize', params: { clientInfo: { name: 'account_renewal', version: '1' } } },
          { method: 'initialized' },
          { id: 2, method: 'account/read', params: { refreshToken: true } },
        ]
          .map((request) => JSON.stringify(request))
          .join('\n') + '\n',
      complete: renewalComplete,
    },
  },
  loggedIn,
};
