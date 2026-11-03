import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { Channel } from '../installation/contract/wire/channel.js';
import { serveLogPath } from '../installation/contract/wire/layout.js';
import { CurrentInvocation, failureLines, refusalOf } from '../platform/cli/verb.js';
import { awaitRestart, comingUp, requestRestart } from '../installation/process/serverStart.js';
import { INSTALLATION_OPERATIONS } from '../installation/contract/wire/operations.js';
import { readStartup } from '../installation/process/record.js';
import { RESTART_RECORD } from '../installation/contract/wire/restart.js';
import { dataDirectoryLocked } from '../platform/lock/holder.js';
import type { BuildServer } from './port.js';
import type { Restart } from '../installation/contract/wire/source.js';
import type { Processes } from '@runlith/execution-host/ProcessReader';

export type CameUp =
  | { readonly _tag: 'Restarted'; readonly url: string; readonly build: string | null }
  | { readonly _tag: 'Checkout'; readonly url: string }
  | { readonly _tag: 'ByHand'; readonly url: string; readonly why: string; readonly holder: number | null }
  | { readonly _tag: 'Nothing'; readonly url: string }
  | { readonly _tag: 'Refused'; readonly url: string; readonly lines: readonly string[] }
  | { readonly _tag: 'Silent'; readonly url: string }
  | { readonly _tag: 'Skipped' };

export const cameUp = Effect.fnUntraced(function* (
  api: BuildServer,
  channel: Channel,
  target: string | null = null,
): Effect.fn.Return<CameUp, never, Processes> {
  const at = yield* CurrentInvocation;
  const url = api.baseUrl(at);
  const holderOf = (): number | null => {
    const log = serveLogPath(channel, process.env);
    const held = log === null || !api.boundHere(at, url) ? null : dataDirectoryLocked(dirname(log));
    return typeof held === 'number' ? held : null;
  };
  const answered = yield* api.healthOrNone();
  if (answered === null) return { _tag: 'Nothing', url };
  if (answered.health.source.installation === null) return { _tag: 'Checkout', url };
  const log = serveLogPath(channel, process.env);
  const local = log !== null && api.boundHere(at, url) ? log : null;
  const progress = local === null ? api.startup() : readStartup(join(dirname(local), RESTART_RECORD));
  const before = yield* progress;
  const request = api
    .ask((door) => door.operations.perform({ params: { id: 'restart_server' }, query: {}, headers: {}, payload: {} }))
    .pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(INSTALLATION_OPERATIONS.restart_server.answer)),
      Effect.map((answer) => (answer as { readonly restart: Restart }).restart),
    );
  const asked = yield* Effect.result(requestRestart(request, before, progress));
  if (asked._tag === 'Failure') {
    const refusal = refusalOf(asked.failure);
    if (refusal?.code === 'no-successor') {
      return {
        _tag: 'ByHand',
        url,
        why: `cannot restart onto the installation that now stands (${refusal.reason})`,
        holder: holderOf(),
      };
    }
    return { _tag: 'Refused', url, lines: failureLines(asked.failure) };
  }
  const expected =
    asked.success?.successor._tag === 'Installation'
      ? asked.success.successor.build
      : (target ?? answered.health.source.installation.build);
  const original = answered.health.source.installation.build;
  const outcome = yield* awaitRestart(
    api.healthOrNone(),
    local === null ? null : () => dataDirectoryLocked(dirname(local)),
    progress,
    {
      isSuccessor: (next, saved) =>
        next.health.source.installation?.build !== original ||
        (before.startup !== null && saved.startup !== null && saved.startup.pid !== before.startup.pid),
      build: (next) => next.health.source.installation?.build ?? null,
      expected,
    },
    local === null ? () => Effect.void : comingUp(url, local),
  );
  if (outcome._tag === 'Failed') return { _tag: 'Refused', url, lines: [outcome.detail] };
  if (outcome._tag === 'Silent') return { _tag: 'Silent', url };
  const up = outcome.answered;
  return { _tag: 'Restarted', url, build: up.health.source.installation?.build ?? null };
});

export const serverLines = (channel: Channel, server: CameUp): string[] => {
  switch (server._tag) {
    case 'Restarted':
      return [`restarted ${server.url} — ${server.build === null ? 'a server this build cannot read' : `installation ${server.build}`}`];
    case 'Checkout':
      return [`${server.url} runs a checkout; it hands out this installation's surface without a restart`];
    case 'ByHand':
      return [
        `${server.url} ${server.why}; end it by hand, this once${server.holder === null ? '' : `: kill ${server.holder}`}`,
        `then ${channel.command} web brings this installation up; every server from here on replaces itself`,
        `then ${channel.command} upgrade refreshes the hooks and MCP declarations of every project`,
      ];
    case 'Nothing':
      return [`nothing runs here; ${channel.command} web brings this installation up`];
    case 'Refused':
      return [`${server.url} did not restart:`, ...server.lines];
    case 'Silent':
      return [`${server.url} left and nothing came up in its place; read ${serveLogPath(channel, process.env) ?? 'the server log'}`];
    case 'Skipped':
      return [];
  }
};
