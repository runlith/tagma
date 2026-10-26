import { Effect, Stream } from 'effect';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import { ServerDoor, type HostedDoor } from '../runner/hosted/door.js';
import { serveClaude } from '../runner/claude-code/run.js';
import { fixtureClaude } from './claudeCode.js';
import type { ServerCli } from '../cli/server.js';
import { CurrentInvocation, processInvocation } from '../../platform/cli/verb.js';

type Input = { readonly report: string; readonly server?: ServerCli };

const unattended: HostedDoor = {
  agent: () => Effect.succeed({ prompt: 'The scripted Claude Code fixture.', web: 'vendor' }),
  tools: () => Effect.succeed({ tools: [], names: [] }),
  history: () => Effect.succeed([]),
  turn: () => Effect.succeed({ context: null, prompt: null, web: 'vendor' }),
  call: () => Effect.never,
};

export const fixtureRunner = Effect.fnUntraced(function* ({ report, server }: Input) {
  const at = processInvocation();
  const door = server === undefined ? unattended : new ServerDoor(server, at);
  const out = Bun.stdout.writer();
  const write = (bytes: Uint8Array) =>
    Effect.try({
      try: () => {
        out.write(bytes);
        out.flush();
      },
      catch: (cause) => new ExchangeFailed({ detail: `stdout failed: ${String(cause)}` }),
    });
  const input = Stream.fromReadableStream({
    evaluate: () => Bun.stdin.stream(),
    onError: (cause) => new ExchangeFailed({ detail: `stdin failed: ${String(cause)}` }),
  });
  yield* serveClaude(
    input,
    write,
    fixtureClaude(report),
    door,
    { claude: '/fixture/claude', version: () => '2.1.306', stderr: (text) => process.stderr.write(text) },
    { model: null, effort: null, version: 'fixture', titled: false },
  ).pipe(Effect.provideService(CurrentInvocation, at));
});
