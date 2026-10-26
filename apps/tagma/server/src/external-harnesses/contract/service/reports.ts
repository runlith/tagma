import { Context, type Effect } from 'effect';
import type { HarnessReportInput, HarnessReceipt } from '../../../threads/contract/wire/harness/observation.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export class HarnessReports extends Context.Service<
  HarnessReports,
  {
    reported(threadId: string, reported: HarnessReportInput): Effect.Effect<HarnessReceipt, HarnessFailure>;
  }
>()('tagma/external-harnesses/HarnessReports') {}
