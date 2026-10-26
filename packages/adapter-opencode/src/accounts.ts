import type { HarnessAccountAuth, HarnessOutput } from '@runlith/tagma/adapter/provider';
import { Data, Effect, Schema } from 'effect';

class AccountRefused extends Data.TaggedError('AccountRefused')<{ readonly message: string }> {}

const status = Schema.Struct({ status: Schema.Literal('needs_auth'), message: Schema.String, url: Schema.optional(Schema.String) });
const connection = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('credential'),
    id: Schema.String,
    label: Schema.String,
    method: Schema.Literals(['key', 'oauth', 'external']),
    status: Schema.optional(status),
  }),
  Schema.Struct({ type: Schema.Literal('env'), name: Schema.String, status: Schema.optional(status) }),
]);
const response = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, connections: Schema.Array(connection) })),
);

const loggedIn = Effect.fnUntraced(function* (output: HarnessOutput) {
  if (output.code !== 0) return yield* new AccountRefused({ message: `OpenCode auth list exited ${output.code}: ${output.stderr.trim()}` });
  const integrations = yield* Schema.decodeUnknownEffect(response)(output.stdout).pipe(
    Effect.mapError((cause) => new AccountRefused({ message: `OpenCode auth list returned invalid JSON: ${cause.message}` })),
  );
  const labels: string[] = [];
  const problems: string[] = [];
  for (const integration of integrations) {
    for (const entry of integration.connections) {
      if (entry.status !== undefined) {
        problems.push(`${integration.name}: ${entry.status.message}`);
        continue;
      }
      labels.push(`${integration.name} · ${entry.type === 'credential' ? entry.label : entry.name}`);
    }
  }
  if (labels.length > 0) return { label: labels.join(', ') };
  if (problems.length > 0) return yield* new AccountRefused({ message: problems.join('; ') });
  return null;
});

export const accounts = (program: string): HarnessAccountAuth => ({
  directory: 'opencode',
  login: { program, args: ['auth', 'login', '--standalone'] },
  status: { program, args: ['auth', 'list', '--standalone', '--format', 'json'] },
  loggedIn,
});
