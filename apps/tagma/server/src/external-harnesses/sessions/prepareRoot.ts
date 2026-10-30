import { Context, Effect, FileSystem, Layer, Stream } from 'effect';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { ExchangeFailed, makeExchange, type ExchangeError, type ExchangeVendorError } from '@runlith/ndjson-rpc/exchange';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type {
  HarnessCutAsk,
  HarnessCutMaking,
  HarnessPrepare,
  PrepareJudgment,
  PrepareAnswer,
  PreparedRoot,
  RpcRequest,
} from '@runlith/tagma/adapter/harness';
import { principalOf } from '../../executions/terminals/principals.js';
import { STOP_LADDER_MS } from '@runlith/executions/protocol/call';
import type { Discharge } from '../../executions/contract/service/discharge.js';
import type { ExecutionRecords } from '../../executions/contract/service/records.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { Environments } from '../../workspace/contract/service/environments.js';
import type { HarnessPlace } from './launch.js';
import { readRootArtifact, type RootArtifactRead } from '../metadata/rootArtifact.js';

export type PrepareRootAnswer =
  | { readonly _tag: 'Prepared'; readonly root: PreparedRoot }
  | { readonly _tag: 'Refused'; readonly reason: string }
  | { readonly _tag: 'Uncertain'; readonly reason: string }
  | { readonly _tag: 'Aborted' };

export type CutRootAnswer =
  | { readonly _tag: 'Cut'; readonly root: PreparedRoot; readonly addresses: readonly (string | null)[] | 'copied' | 'unaddressed' }
  | Exclude<PrepareRootAnswer, { readonly _tag: 'Prepared' }>;

type Halted = Exclude<PrepareRootAnswer, { readonly _tag: 'Prepared' }>;

const CLIENT = { name: 'tagma', version: '0.1.0' } as const;

export const PREPARE_BUDGET_MS = 60_000;

type TransportFailure = Exclude<ExchangeError, ExchangeVendorError>;

type Step = Effect.Effect<PrepareAnswer, TransportFailure>;

type Talk = {
  readonly judged: <T>(
    name: string,
    minted: boolean,
    request: () => RpcRequest,
    judge: (answer: PrepareAnswer) => PrepareJudgment<T>,
  ) => Effect.Effect<{ readonly _tag: 'Ok'; readonly value: T } | Halted>;
};

type Preparing = {
  readonly terminals: Terminals['Service'];
  readonly writing: TerminalWriting['Service'];
  readonly records: ExecutionRecords['Service'];
  readonly discharge: Discharge['Service'];
  readonly place: HarnessPlace;
};

const outcome = (step: Effect.Effect<unknown, ExchangeError>): Step =>
  step.pipe(
    Effect.map((value) => ({ _tag: 'Answered' as const, value })),
    Effect.catchTag('ExchangeVendorError', (vendor) =>
      Effect.succeed({ _tag: 'VendorError' as const, code: vendor.code, message: vendor.message }),
    ),
  );

const converse = <A>(
  { terminals, writing, records, discharge, place }: Preparing,
  server: { readonly program: string; readonly args: ReadonlyArray<string> },
  key: { readonly kind: 'prep' | 'cut'; readonly session: string },
  talk: (said: Talk) => Effect.Effect<A | Halted>,
): Effect.Effect<A | Halted> =>
  Effect.scoped(
    Effect.gen(function* () {
      const principal = principalOf(place.actor);
      const started = yield* terminals.start({
        actor: place.actor,
        operationId: HostRequestKey.make(`harness-${key.kind}:${key.session}`),
        target: place.target,
        targetKey: place.targetKey,
        program: server.program,
        args: [...server.args],
        transport: 'pipes',
        stdin: 'pipe',
        stdinHeld: true,
        lifetime: 'call',
        purpose: 'internal',
        environment: place.environment,
        budget: { timeoutMs: PREPARE_BUDGET_MS },
      });
      if (started._tag !== 'Started') {
        return started._tag === 'Uncertain'
          ? ({ _tag: 'Uncertain', reason: `the ${server.program} preparation server start receipt is unknown` } as const)
          : ({ _tag: 'Refused', reason: `the ${server.program} preparation server did not start (${started._tag})` } as const);
      }
      const record = started.record;
      const pipe = started.pipe;
      let gone = false;
      const retire = discharge
        .retire(
          record.projectId,
          { installation: record.execution.installation, operation: HostRequestKey.make(`harness-${key.kind}-retire:${key.session}`) },
          record.execution,
        )
        .pipe(
          Effect.catch(() => Effect.logWarning('harness preparation server record could not be retired')),
          Effect.asVoid,
        );
      const halt = terminals
        .stop(
          record.projectId,
          {
            projectId: record.projectId,
            operationId: HostRequestKey.make(`harness-${key.kind}-stop:${key.session}`),
            requester: principal,
            mutation: 'stop',
            targetKey: record.targetKey,
            execution: record.execution,
          },
          record.execution,
          record.revision,
          'scope-closed',
          'signal',
        )
        .pipe(
          Effect.catch(() => Effect.logWarning('harness preparation server cleanup could not be confirmed')),
          Effect.asVoid,
        );
      yield* Effect.addFinalizer(() => Effect.andThen(gone ? Effect.void : halt, retire));
      if (pipe === undefined) {
        return { _tag: 'Refused', reason: `the ${server.program} preparation server opened no input for this launch` } as const;
      }
      let sequence = 0;
      const exchange = makeExchange({
        write: (bytes) =>
          writing.pipeInput(pipe, { _tag: 'Write', bytes }, sequence++).pipe(
            Effect.catch((failure) => Effect.succeed({ _tag: 'InputUnavailable' as const, reason: failure._tag })),
            Effect.flatMap((admitted) =>
              admitted._tag === 'InputAdmitted'
                ? Effect.void
                : Effect.fail(new ExchangeFailed({ detail: `the preparation server would not take its input: ${admitted._tag}` })),
            ),
          ),
        read: (offset) =>
          records.records({ ref: record.execution, stream: 'stdout', offset: ByteOffset.make(String(offset)) }).pipe(
            Stream.takeWhile((delivery) => delivery._tag !== 'Ended'),
            Stream.filter((delivery): delivery is Extract<typeof delivery, { readonly _tag: 'Bytes' }> => delivery._tag === 'Bytes'),
            Stream.map((delivery) => delivery.bytes),
            Stream.mapError(
              (failure) => new ExchangeFailed({ detail: `the preparation server output could not be read: ${failure._tag}` }),
            ),
          ),
      });
      const judged: Talk['judged'] = (name, minted, request, judge) =>
        Effect.suspend(() => {
          const asked = request();
          return outcome(exchange.request(asked.method, asked.params, PREPARE_BUDGET_MS));
        }).pipe(
          Effect.map((answer) => {
            const verdict = judge(answer);
            return verdict._tag === 'Accept'
              ? { _tag: 'Ok' as const, value: verdict.value }
              : ({ _tag: 'Refused' as const, reason: `${name}: ${verdict.reason}` } satisfies Halted);
          }),
          Effect.catch((failure) =>
            Effect.succeed(
              minted
                ? ({ _tag: 'Uncertain' as const, reason: `${name}: ${failure.detail}` } satisfies Halted)
                : ({ _tag: 'Refused' as const, reason: `${name}: ${failure.detail}` } satisfies Halted),
            ),
          ),
        );
      const answered = yield* talk({ judged });
      yield* writing.pipeInput(pipe, { _tag: 'End' }, sequence++).pipe(Effect.ignore);
      const ending = yield* terminals.wait(record.execution, STOP_LADDER_MS).pipe(Effect.catch(() => Effect.succeed(undefined)));
      gone = ending?._tag === 'Decided';
      return answered;
    }),
  ).pipe(Effect.catch((failure) => Effect.succeed({ _tag: 'Uncertain', reason: `the preparation failed: ${failure._tag}` } as const)));

const verified = (access: Environments['Service'], adapter: HarnessAdapter, place: HarnessPlace, root: PreparedRoot) =>
  Effect.map(verifyPreparedRoot(access, adapter, place, root), (read): Halted | null =>
    read._tag === 'Bound'
      ? null
      : read._tag === 'Refused'
        ? { _tag: 'Refused', reason: `artifact: ${read.reason}` }
        : { _tag: 'Uncertain', reason: `artifact: ${read.reason}` },
  );

export function prepareRoot(
  terminals: Terminals['Service'],
  writing: TerminalWriting['Service'],
  records: ExecutionRecords['Service'],
  discharge: Discharge['Service'],
  access: Environments['Service'],
  adapter: HarnessAdapter,
  prepare: HarnessPrepare,
  place: HarnessPlace,
  input: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly stopping: Effect.Effect<boolean>;
  },
): Effect.Effect<PrepareRootAnswer> {
  return converse(
    { terminals, writing, records, discharge, place },
    prepare.server(input.cwd),
    { kind: 'prep', session: input.sessionId },
    Effect.fnUntraced(function* ({ judged }) {
      if (yield* input.stopping) return { _tag: 'Aborted' } as const;
      const handshake = yield* judged('initialize', false, () => prepare.initialize.request(CLIENT), prepare.initialize.judge);
      if (handshake._tag !== 'Ok') return handshake;
      if (yield* input.stopping) return { _tag: 'Aborted' } as const;
      const mint = yield* judged('thread/start', true, () => prepare.start.request(input.cwd), prepare.start.judge);
      if (mint._tag !== 'Ok') return mint;
      const root = mint.value;
      if (yield* input.stopping) return { _tag: 'Aborted' } as const;
      const materialized = yield* judged('thread/read', true, () => prepare.read.request(root.id), prepare.read.judge);
      if (materialized._tag !== 'Ok') return materialized;
      return { _tag: 'Prepared', root } as const;
    }),
  ).pipe(
    Effect.flatMap((answer) =>
      answer._tag !== 'Prepared'
        ? Effect.succeed(answer)
        : Effect.map(verified(access, adapter, place, answer.root), (halted): PrepareRootAnswer => halted ?? answer),
    ),
    Effect.tap((result) => Effect.withSpan(Effect.void, `HarnessPrepare.${result._tag.toLowerCase()}`)),
    Effect.withSpan('HarnessPrepare.root'),
  );
}

export function cutRoot(
  terminals: Terminals['Service'],
  writing: TerminalWriting['Service'],
  records: ExecutionRecords['Service'],
  discharge: Discharge['Service'],
  access: Environments['Service'],
  adapter: HarnessAdapter,
  making: Extract<HarnessCutMaking, { readonly _tag: 'Prepare' }>,
  place: HarnessPlace,
  input: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly ask: HarnessCutAsk;
  },
): Effect.Effect<CutRootAnswer> {
  return Effect.suspend(() =>
    converse(
      { terminals, writing, records, discharge, place },
      making.server(input.cwd),
      { kind: 'cut', session: `${input.sessionId}:${crypto.randomUUID()}` },
      Effect.fnUntraced(function* ({ judged }) {
        const handshake = yield* judged('initialize', false, () => making.initialize.request(CLIENT), making.initialize.judge);
        if (handshake._tag !== 'Ok') return handshake;
        const cut = yield* judged('fork', true, () => making.fork.request(input.ask, input.cwd), making.fork.judge);
        if (cut._tag !== 'Ok') return cut;
        const rows = making.rows;
        if (typeof rows === 'string') return { _tag: 'Cut', root: cut.value, addresses: rows } as const;
        const turns = yield* judged('turns', true, () => rows.request(cut.value.id), rows.judge);
        if (turns._tag !== 'Ok') return turns;
        return { _tag: 'Cut', root: cut.value, addresses: turns.value } as const;
      }),
    ),
  ).pipe(
    Effect.flatMap((answer) =>
      answer._tag !== 'Cut'
        ? Effect.succeed(answer)
        : Effect.map(verified(access, adapter, place, answer.root), (halted): CutRootAnswer => halted ?? answer),
    ),
    Effect.tap((result) => Effect.withSpan(Effect.void, `HarnessPrepare.${result._tag.toLowerCase()}`)),
    Effect.withSpan('HarnessPrepare.cut'),
  );
}

export const verifyPreparedRoot = (
  access: Environments['Service'],
  adapter: HarnessAdapter,
  place: HarnessPlace,
  root: PreparedRoot,
): Effect.Effect<RootArtifactRead> => {
  const consumer = { kind: 'harness-prepare', id: root.artifact };
  return Effect.scoped(
    Effect.gen(function* () {
      const acquired = yield* access.acquireActive({ binding: place.target.binding, consumer, requires: ['files'] });
      yield* Effect.addFinalizer(() =>
        acquired.use._tag === 'Retained'
          ? access.releaseUse(acquired.use.use.useId, consumer, 'cleanup-confirmed').pipe(
              Effect.catch(() => Effect.logWarning('harness preparation environment use could not be released')),
              Effect.asVoid,
            )
          : Effect.void,
      );
      if (acquired.world.files === undefined) return { _tag: 'Unreadable', reason: 'files-unsupported' } as const;
      const files = Context.get(yield* Layer.build(acquired.world.files), FileSystem.FileSystem);
      return yield* readRootArtifact(files, adapter, root.id, root.artifact);
    }),
  ).pipe(Effect.catch((failure) => Effect.succeed({ _tag: 'Unreadable', reason: failure._tag } as const)));
};
