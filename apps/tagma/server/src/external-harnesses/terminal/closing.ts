import { Clock, Effect } from 'effect';
import { sumUsage, type Usage } from '@runlith/llm/schema/events';
import type { ModelCatalog, ModelOption } from '@runlith/llm/models/catalog';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import type { ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { AdapterReports, MeasuredRequest, ReportPlan, RunEnding } from '@runlith/agent/thread/run/lifecycle/RunReports';
import type { Environments } from '../../workspace/contract/service/environments.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import { inputOf } from '../metadata/harnessMetadata.js';
import type { TranscriptRequest } from '@runlith/tagma/adapter/metadata';
import { readHarnessTranscript, transcriptUsage, type HarnessReading } from '../metadata/words.js';

export type TurnSpend = {
  readonly run: string;
  readonly requests: readonly { readonly id: string; readonly request: MeasuredRequest }[];
  readonly rest: Usage | undefined;
};

const DATED = /^-\d{8}$/;

const catalogued = (models: ModelCatalog, provider: string | null, model: string | null): ModelOption | undefined =>
  provider === null || model === null || !models.registered(provider)
    ? undefined
    : models.modelsOf(provider).find((each) => each.id === model || (model.startsWith(each.id) && DATED.test(model.slice(each.id.length))));

export class TerminalClosing {
  constructor(
    private readonly access: Environments['Service'],
    private readonly models: Effect.Effect<ModelCatalog>,
    private readonly reports: AdapterReports,
    private readonly adapters: HarnessAdapters['Service'],
  ) {}

  readonly spent = Effect.fnUntraced(function* (this: TerminalClosing, threadId: string, facet: ExternalSession) {
    const turn = facet.turn;
    const input = inputOf(facet);
    const adapter = this.adapters.running(facet);
    if (turn === undefined || input === null || adapter === null || !transcriptUsage(adapter)) return null;
    const read = yield* Effect.result(readHarnessTranscript(this.access, input, adapter, turn.offset ?? 0));
    if (read._tag === 'Failure' || !read.success.complete) {
      yield* Effect.logWarning('the transcript of an ended terminal turn was not read whole; its run records no requests', {
        threadId,
        cause: read._tag === 'Failure' ? read.failure : 'incomplete',
      });
      return null;
    }
    return yield* this.measure(facet, read.success);
  });

  readonly measure = Effect.fnUntraced(function* (this: TerminalClosing, facet: ExternalSession, reading: HarnessReading) {
    const turn = facet.turn;
    if (turn === undefined) return null;
    if (reading.skipped > 0) {
      yield* Effect.logWarning('the transcript of an ended terminal turn held records too large to read; its run records no requests', {
        run: turn.run,
        skipped: reading.skipped,
      });
      return null;
    }
    const since = Date.parse(turn.openedAt);
    const turnOf = [...reading.requests.values()].filter((request) => turn.offset !== null || request.at === null || request.at >= since);
    const main = turnOf.filter((request) => request.main);
    const rest = turnOf
      .filter((request) => !request.main)
      .reduce<Usage | undefined>((total, request) => sumUsage(total, request.usage), undefined);
    if (main.length === 0) return { run: turn.run, requests: [], rest } satisfies TurnSpend;
    const models = yield* this.models;
    const provider = facet.presentation.modelProvider;
    const now = yield* Clock.currentTimeMillis;
    const readingOf = (request: TranscriptRequest): ThreadContextReading => {
      const option = catalogued(models, provider, request.model);
      return {
        usage: request.usage,
        contextWindow: option?.capacity?.context ?? null,
        runId: turn.run,
        stepNumber: 0,
        provider,
        model: option?.id ?? request.model,
        measuredAt: new Date(request.at ?? now).toISOString(),
        stale: false,
      };
    };
    return {
      run: turn.run,
      requests: main.map((request, index) => ({
        id: request.id,
        request: { usage: request.usage, attempt: 1, reading: index === main.length - 1 ? readingOf(request) : undefined },
      })),
      rest,
    } satisfies TurnSpend;
  });

  close(run: ThreadRunRef, ending: RunEnding, spent: TurnSpend | null): readonly ReportPlan[] {
    const { reports } = this;
    const own = spent !== null && spent.run === run.id ? spent : null;
    return [
      ...(own?.requests ?? []).map(({ id, request }) => reports.measured(run, request, `measured:${id}`)),
      reports.ended(run, ending, own?.rest === undefined ? undefined : { rest: own.rest }),
    ];
  }
}
