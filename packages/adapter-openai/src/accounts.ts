import { homedir } from 'node:os';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { HarnessAccountAuth, HarnessLoginStatus, HarnessOutput } from '@runlith/tagma/adapter/provider';

const SUBSCRIPTION = 'Logged in using ChatGPT';
const SIGNED_OUT = 'Not logged in';

function loggedIn(output: HarnessOutput): Effect.Effect<HarnessLoginStatus> {
  const said = `${output.stdout}\n${output.stderr}`.trim();
  if (said.includes(SIGNED_OUT)) return Effect.succeed({ kind: 'signed-out' });
  if (output.code === 0) {
    if (said.includes(SUBSCRIPTION)) return Effect.succeed({ kind: 'signed-in', label: 'ChatGPT' });
    if (/^API key configured(?: - .*)?$/mu.test(said)) return Effect.succeed({ kind: 'unsupported-method', method: 'API key' });
    const method = /^Logged in using (.+?)(?: - .*)?$/mu.exec(said)?.[1];
    if (method !== undefined) return Effect.succeed({ kind: 'unsupported-method', method });
  }
  return Effect.succeed({
    kind: 'unreadable',
    reason: `Codex login status answered something unreadable: ${said || `exit ${output.code}`}`,
  });
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
  discovery: { variable: 'CODEX_HOME', directory: join(homedir(), '.codex'), files: ['auth.json'] },
  renew: {
    program: 'codex',
    args: ['app-server', '-c', 'analytics.enabled=false', '-c', 'otel.exporter="none"'],
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
