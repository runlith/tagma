import { Clock, Context, Effect, Exit, FileSystem, Layer, Scope } from 'effect';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { TerminalRecord } from '../../executions/contract/wire/terminals.js';
import { principalOf } from '../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../executions/terminals/subjectPolicy.js';
import type { Discharge } from '../../executions/contract/service/discharge.js';
import type { ExecutionRecords, TerminalScreens } from '../../executions/contract/service/records.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { Environments } from '../../workspace/contract/service/environments.js';
import type { HarnessFields, HarnessField } from '../../threads/contract/wire/harness/observation.js';
import { emptyValues, metadataField } from './fields.js';
import { MetadataIndex } from './sessionIndex.js';
import { MetadataCommands } from './commands.js';
import { MetadataInvalid, type MetadataPage } from './file.js';
import type { MetadataValues } from './fields.js';
import type { MetadataInput, MetadataLocation } from './sources.js';
import { METADATA_LIMITS } from './policy.js';

export type MetadataRead = () => Effect.Effect<{ readonly fields: Partial<HarnessFields>; readonly more: boolean }>;

const missedOf = (page: MetadataPage<MetadataValues>, name: keyof HarnessFields): number =>
  page._tag !== 'Read' ? 0 : page.missed === undefined ? page.skipped : (page.missed[name] ?? 0);

export class MetadataBackend {
  private readonly commands = new MetadataCommands();

  constructor(
    private readonly access: Environments['Service'],
    private readonly terminals: Terminals['Service'],
    private readonly screens: TerminalScreens['Service'],
    private readonly records: ExecutionRecords['Service'],
    private readonly discharge: Discharge['Service'],
    private readonly index: MetadataIndex,
  ) {}

  available(input: MetadataInput) {
    return Effect.map(
      this.access.inspect(input.storage.binding.kind, { binding: input.storage.binding }),
      (state) => state.availability === 'available',
    );
  }

  readonly open = Effect.fn('HarnessMetadata.access')(function* (
    this: MetadataBackend,
    input: MetadataInput,
    sources: readonly MetadataLocation[],
  ) {
    const { access, terminals, screens, index, commands } = this;
    const command = (record: TerminalRecord, source: Extract<MetadataLocation, { kind: 'command' }>, operation: HostRequestKey) =>
      this.command(input, record, source, operation);
    const consumer = { kind: 'harness-metadata', id: input.execution.execution };
    const acquired = yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const acquired = yield* restore(
          access.acquireActive({ binding: input.storage.binding, consumer, requires: ['files'] }).pipe(
            Scope.provide(scope),
            Effect.mapError(() => new MetadataInvalid({ reason: 'path' })),
          ),
        ).pipe(
          Effect.tapError(() => Scope.close(scope, Exit.void)),
          Effect.onInterrupt(() => Scope.close(scope, Exit.void)),
        );
        yield* Effect.addFinalizer(() =>
          Scope.close(scope, Exit.void).pipe(
            Effect.andThen(
              acquired.use._tag === 'Retained'
                ? access
                    .releaseUse(acquired.use.use.useId, consumer, 'cleanup-confirmed')
                    .pipe(Effect.catch(() => Effect.logWarning('metadata environment use could not be released')))
                : Effect.void,
            ),
          ),
        );
        return acquired;
      }),
    );
    if (acquired.world.files === undefined) return yield* new MetadataInvalid({ reason: 'path' });
    const files = Context.get(yield* Layer.build(acquired.world.files), FileSystem.FileSystem);
    const record = yield* terminals
      .record(input.execution.execution, input.execution.incarnation)
      .pipe(Effect.mapError(() => new MetadataInvalid({ reason: 'identity' })));
    if (record === null) return yield* new MetadataInvalid({ reason: 'identity' });
    return yield* Effect.forEach(sources, (source) =>
      Effect.gen(function* () {
        let read: () => Effect.Effect<MetadataPage<MetadataValues>>;
        switch (source.kind) {
          case 'file': {
            const cursor = source.open(METADATA_LIMITS);
            read = () => cursor(files);
            break;
          }
          case 'index': {
            const held = yield* index.watch(JSON.stringify(input.storage.binding), source.root, source.path, input.rootKey, source.parse);
            read = () =>
              held.read(files).pipe(
                Effect.map((page) =>
                  page._tag === 'Read'
                    ? {
                        ...page,
                        value: {
                          ...emptyValues(),
                          title: page.value === null ? null : { value: page.value, claim: 'last-recorded' as const, turnId: null },
                        },
                      }
                    : page,
                ),
              );
            break;
          }
          case 'terminal':
            read = () =>
              screens.screen(record.execution, { cells: source.cells }).pipe(
                Effect.flatMap((screen) =>
                  Effect.try({
                    try: () => ({
                      _tag: 'Read' as const,
                      complete: true,
                      bytes: 0,
                      records: 1,
                      skipped: 0,
                      value: { ...emptyValues(), title: source.parse(screen) },
                    }),
                    catch: (cause) => (cause instanceof MetadataInvalid ? cause : new MetadataInvalid({ reason: 'malformed' })),
                  }),
                ),
                Effect.catchTag('MetadataInvalid', (failure) => Effect.succeed({ _tag: 'Unreadable', reason: failure.reason } as const)),
                Effect.catch(() => Effect.succeed({ _tag: 'Unreadable', reason: 'terminal-unavailable' } as const)),
              );
            break;
          case 'command': {
            let operation = HostRequestKey.make(`harness-metadata:${crypto.randomUUID()}`);
            const key = JSON.stringify([record.projectId, input.storage, input.cwd, source.program, source.args]);
            const held = yield* commands.watch(key, () =>
              command(record, source, operation).pipe(
                Effect.tap((page) =>
                  Effect.sync(() => {
                    if (page._tag !== 'Unreadable' || page.reason !== 'command-uncertain')
                      operation = HostRequestKey.make(`harness-metadata:${crypto.randomUUID()}`);
                  }),
                ),
              ),
            );
            read = () =>
              held.read().pipe(
                Effect.flatMap((page): Effect.Effect<MetadataPage<MetadataValues>, MetadataInvalid> => {
                  if (page._tag !== 'Read') return Effect.succeed(page);
                  return Effect.try({
                    try: () => ({ ...page, value: { ...emptyValues(), title: source.parse(page.value) } }),
                    catch: (cause) => (cause instanceof MetadataInvalid ? cause : new MetadataInvalid({ reason: 'malformed' })),
                  });
                }),
                Effect.catchTag('MetadataInvalid', (failure) => Effect.succeed({ _tag: 'Unreadable', reason: failure.reason } as const)),
              );
            break;
          }
          case 'unreadable':
            read = () => Effect.succeed({ _tag: 'Unreadable', reason: source.reason });
            break;
          case 'unsupported':
            read = () => Effect.succeed({ _tag: 'Absent' });
            break;
        }
        return (() =>
          read().pipe(
            Effect.flatMap((page) =>
              Effect.gen(function* () {
                if (page._tag === 'Read' && !page.complete) return { fields: {}, more: page.bytes > 0 || page.records > 0 };
                const fields: Partial<Record<keyof HarnessFields, HarnessField>> = {};
                const observedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
                for (const name of source.fields) {
                  fields[name] =
                    source.kind === 'unsupported'
                      ? { _tag: 'Unsupported', source: source.source, scope: { rootKey: input.rootKey, turnId: null }, observedAt }
                      : page._tag === 'Unreadable'
                        ? {
                            _tag: 'Unreadable',
                            source: source.source,
                            scope: { rootKey: input.rootKey, turnId: null },
                            observedAt,
                            reason: page.reason,
                            lastKnown: null,
                          }
                        : metadataField(
                            page._tag === 'Read' ? page.value[name] : null,
                            source.source,
                            input.rootKey,
                            observedAt,
                            missedOf(page, name),
                          );
                }
                return { fields, more: false };
              }),
            ),
          )) satisfies MetadataRead;
      }),
    );
  });

  private readonly command = Effect.fn('HarnessMetadata.command')(
    function* (
      this: MetadataBackend,
      input: MetadataInput,
      record: TerminalRecord,
      source: Extract<MetadataLocation, { kind: 'command' }>,
      operation: HostRequestKey,
    ) {
      const { terminals, records, discharge } = this;
      const principal = principalOf({ _tag: 'Operator' });
      const target = yield* terminals.target({
        projectId: record.projectId,
        kind: input.storage.binding.kind,
        binding: input.storage.binding,
        cwd: input.cwd,
      });
      const start = yield* terminals.start({
        actor: { _tag: 'Operator' },
        operationId: operation,
        target,
        targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
        program: source.program,
        args: source.args,
        transport: 'pipes',
        lifetime: 'call',
        stdin: 'ignore',
        purpose: 'internal',
        environment: { inherit: false, entries: input.storage.entries.map((entry) => ({ _tag: 'Set', ...entry })) },
        budget: { timeoutMs: 20_000 },
      });
      if (start._tag !== 'Started')
        return { _tag: 'Unreadable', reason: start._tag === 'Uncertain' ? 'command-uncertain' : 'command-refused' } as const;
      yield* Effect.addFinalizer(() =>
        terminals
          .stop(
            record.projectId,
            {
              projectId: record.projectId,
              operationId: HostRequestKey.make(`metadata-stop:${operation}`),
              requester: principal,
              mutation: 'stop',
              targetKey: start.record.targetKey,
              execution: start.record.execution,
            },
            start.record.execution,
            start.record.revision,
            'scope-closed',
            'signal',
          )
          .pipe(
            Effect.catch(() => Effect.logWarning('metadata command cleanup could not be confirmed')),
            Effect.andThen(
              discharge
                .retire(
                  record.projectId,
                  { installation: start.record.execution.installation, operation: HostRequestKey.make(`metadata-retire:${operation}`) },
                  start.record.execution,
                )
                .pipe(Effect.catch(() => Effect.logWarning('metadata command record could not be retired'))),
            ),
          ),
      );
      const ended = yield* terminals.wait(start.record.execution, 20_000);
      if (ended._tag !== 'Decided' || ended.summary.state.nativeExit?._tag !== 'Code' || ended.summary.state.nativeExit.code !== 0) {
        return { _tag: 'Unreadable', reason: 'command-failed' } as const;
      }
      const stream = ended.summary.streams.find((stream) => stream.stream === 'stdout');
      if (stream === undefined || stream.ending !== 'eof' || BigInt(stream.retainedFrom) !== 0n)
        return { _tag: 'Unreadable', reason: 'command-output-unavailable' } as const;
      if (BigInt(stream.durableThrough) > BigInt(METADATA_LIMITS.recordBytes))
        return { _tag: 'Unreadable', reason: 'command-output-limit' } as const;
      const size = Number(stream.durableThrough);
      const parts: Uint8Array[] = [];
      let offset = 0;
      while (offset < size) {
        const part = yield* records.bytes(
          { ref: start.record.execution, stream: 'stdout', offset: ByteOffset.make(String(offset)) },
          Math.min(METADATA_LIMITS.bytes, size - offset),
        );
        if (part.range.gap || part.bytes.length === 0) return { _tag: 'Unreadable', reason: 'command-output-unavailable' } as const;
        parts.push(part.bytes);
        offset += part.bytes.length;
      }
      return yield* Effect.try({
        try: () => {
          const bytes = new Uint8Array(offset);
          let at = 0;
          for (const part of parts) {
            bytes.set(part, at);
            at += part.length;
          }
          return {
            _tag: 'Read' as const,
            complete: true,
            bytes: offset,
            records: 1,
            skipped: 0,
            value: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          };
        },
        catch: () => new MetadataInvalid({ reason: 'malformed' }),
      });
    },
    Effect.scoped,
    Effect.catchTag('TerminalRefused', () => Effect.succeed({ _tag: 'Unreadable', reason: 'command-refused' } as const)),
    Effect.catchTag('TerminalUnavailable', () => Effect.succeed({ _tag: 'Unreadable', reason: 'command-unavailable' } as const)),
    Effect.catch(() => Effect.succeed({ _tag: 'Unreadable', reason: 'command-uncertain' } as const)),
  );
}
