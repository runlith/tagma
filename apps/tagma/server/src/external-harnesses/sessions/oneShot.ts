import { Effect } from 'effect';
import { note } from '@runlith/activity/Activity';
import { HostRequestKey, type ExecutionRef, type NativeExit, type EnvironmentEntry } from '@runlith/executions/protocol/execution';
import type { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { principalOf } from '../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../executions/terminals/subjectPolicy.js';
import type { Discharge } from '../../executions/contract/service/discharge.js';
import type { ExecutionRecords } from '../../executions/contract/service/records.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalWaitAnswer } from '../../executions/contract/wire/terminals.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { Harness, HarnessAnswer } from '../../threads/contract/service/harness.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { harnessAdapter } from '../contract/service/table.js';
import type { SessionPlace } from '../protocol/prompts.js';
import { accountFor } from './launch.js';

const ANSWER_MS = 60_000;
const ANSWER_BYTES = 1024 * 1024;

type OneShot = NonNullable<Harness['Service']['oneShot']>;

type CliOutput = { readonly stdout: string | null; readonly execution: ExecutionRef; readonly exit?: NativeExit };

const stdout = Effect.fnUntraced(function* (
  records: ExecutionRecords['Service'],
  execution: ExecutionRef,
  ended: Extract<TerminalWaitAnswer, { readonly _tag: 'Decided' }>,
) {
  const stream = ended.summary.streams.find((candidate) => candidate.stream === 'stdout');
  if (
    stream === undefined ||
    stream.ending !== 'eof' ||
    BigInt(stream.retainedFrom) !== 0n ||
    BigInt(stream.durableThrough) > BigInt(ANSWER_BYTES)
  )
    return null;
  const size = Number(stream.durableThrough);
  const bytes = new Uint8Array(size);
  let offset = 0n;
  while (offset < BigInt(size)) {
    const part = yield* records.bytes({ ref: execution, stream: 'stdout', offset: ByteOffset.make(String(offset)) }, size - Number(offset));
    if (part.range.gap || part.bytes.length === 0) return null;
    bytes.set(part.bytes, Number(offset));
    offset += BigInt(part.bytes.length);
  }
  return new TextDecoder().decode(bytes);
});

const stdoutOf = Effect.fn('HarnessOneShot.ask')(
  function* (
    terminals: Terminals['Service'],
    records: ExecutionRecords['Service'],
    discharge: Discharge['Service'],
    projectId: number,
    cwd: string,
    argv: readonly [string, ...string[]],
    environment: readonly EnvironmentEntry[],
  ) {
    const actor = { _tag: 'Operator' } as const;
    const principal = principalOf(actor);
    const operation = crypto.randomUUID();
    const target = yield* terminals.target({ projectId, kind: 'host', cwd });
    const start = yield* terminals.start({
      actor,
      operationId: HostRequestKey.make(`harness-ask:${operation}`),
      target,
      targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
      program: argv[0],
      args: argv.slice(1),
      transport: 'pipes',
      lifetime: 'call',
      stdin: 'ignore',
      purpose: 'internal',
      environment: {
        inherit: true,
        entries: environment,
      },
      budget: { timeoutMs: ANSWER_MS },
    });
    if (start._tag !== 'Started') return null;
    const record = start.record;
    const ended = yield* terminals.wait(record.execution, ANSWER_MS);
    if (ended._tag !== 'Decided') {
      yield* terminals.stop(
        projectId,
        {
          projectId,
          operationId: HostRequestKey.make(`harness-ask-stop:${operation}`),
          requester: principal,
          mutation: 'stop',
          targetKey: record.targetKey,
          execution: record.execution,
        },
        record.execution,
        record.revision,
        'timeout',
        'signal',
      );
    }
    const answer: CliOutput | null =
      ended._tag === 'Decided'
        ? {
            stdout: yield* stdout(records, record.execution, ended),
            execution: record.execution,
            exit: ended.summary.state.nativeExit,
          }
        : null;
    yield* discharge.retire(
      projectId,
      { installation: record.execution.installation, operation: HostRequestKey.make(`harness-ask-retire:${operation}`) },
      record.execution,
    );
    return answer;
  },
  Effect.scoped,
  Effect.mapError(threadCallFailed),
);

export const harnessOneShot = (
  terminals: Terminals['Service'],
  records: ExecutionRecords['Service'],
  discharge: Discharge['Service'],
  place: SessionPlace,
  name: HarnessName,
  accounts: HarnessAccounts['Service'],
): Harness['Service']['oneShot'] => {
  const adapter = harnessAdapter(name);
  const declared = adapter.launch?.oneShot;
  if (declared === undefined) return undefined;
  return {
    capacity: declared.capacity,
    ask: Effect.fnUntraced(function* (threadId: string, question: Parameters<OneShot['ask']>[1]) {
      const where = yield* place(threadId);
      const argv = declared.argv(question.system, question.text);
      yield* note({ type: 'cli-command', command: argv, model: declared.model });
      const account = yield* accountFor(accounts, name, where.selection).pipe(Effect.mapError(threadCallFailed));
      const environment: readonly EnvironmentEntry[] = [
        ...Object.entries(adapter.env ?? {}).map(([name, value]) => ({ _tag: 'Set' as const, name, value })),
        ...(account?.entries ?? []),
      ];
      const output = yield* stdoutOf(terminals, records, discharge, where.projectId, where.root, argv, environment);
      if (output === null) return null;
      yield* note({ type: 'cli-exit', execution: output.execution, exit: output.exit ?? null });
      const parsed = output.stdout === null ? null : declared.answer(output.stdout);
      const succeeded = output.exit?._tag === 'Code' && output.exit.code === 0;
      const answer: HarnessAnswer =
        succeeded && parsed !== null
          ? { ...parsed, exit: output.exit! }
          : {
              outcome: 'failed',
              text: parsed?.text ?? output.stdout,
              reason:
                parsed?.outcome === 'failed'
                  ? parsed.reason
                  : !succeeded
                    ? 'cli-exit'
                    : output.stdout === null
                      ? 'stdout-unavailable'
                      : 'invalid-result',
              exit: output.exit,
              usage: parsed?.usage === undefined ? undefined : parsed.usage,
            };
      if (answer.usage !== undefined) yield* note({ type: 'usage', usage: answer.usage });
      return answer;
    }),
  };
};
