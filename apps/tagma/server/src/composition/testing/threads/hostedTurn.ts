import { Context, Effect, FileSystem, Schema } from 'effect';
import { hostedContentSchema } from '@runlith/hosted-runner/wire/messages';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { turnsOf } from '../../../threads/testing/doubles.js';
import { heard, signal, until } from './protocolRig.js';
import { ProtocolWorld } from './protocolWorld.js';

const calledSchema = Schema.Struct({ content: Schema.Array(hostedContentSchema), failed: Schema.Boolean });

export type HostedCalled = typeof calledSchema.Type;

export const textOf = (called: HostedCalled): string => called.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');

export const heldTurn = Effect.fnUntraced(function* (label: string, mode: 'bypass' | 'review') {
  const { world, projectId, agent, birth, changes } = yield* ProtocolWorld;
  const files = yield* FileSystem.FileSystem;
  const report = yield* agent(label);
  const threadId = yield* birth();
  yield* Context.get(world.runtime.owners, ThreadHarness).threads.handle(threadId, 'operator').setAuthorityMode(mode);
  const asThread = (id: string, input: object) => world.op(id, input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId) });
  const sealed = Effect.fnUntraced(function* (toolCallId: string, name: string, input: object) {
    yield* signal(`${report}.announce`, JSON.stringify({ toolCallId, name, input }));
    yield* until(
      Effect.map(files.readFileString(`${report}.out`), (out) => (out.includes(`said-${toolCallId}`) ? true : null)),
      `the agent sealed ${toolCallId}`,
      report,
      changes(threadId),
    );
    return yield* asThread('call_hosted_tool', { toolCallId, name, input });
  });
  const called = Effect.fnUntraced(function* (toolCallId: string, name: string, input: object) {
    return yield* Schema.decodeUnknownEffect(calledSchema)((yield* sealed(toolCallId, name, input)).body);
  });
  yield* turnsOf(world.runtime.owners).send(threadId, projectId, 'HOLD the turn');
  yield* until(
    Effect.map(heard(report), (lines) => (lines.some((line) => line.method === 'session/prompt') ? true : null)),
    'the turn reached the agent',
    report,
    changes(threadId),
  );
  yield* asThread('open_hosted_turn', {});
  return { threadId, report, sealed, called, release: files.writeFileString(`${report}.release`, 'release') };
});
