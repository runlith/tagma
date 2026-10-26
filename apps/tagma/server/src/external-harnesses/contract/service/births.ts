import type { Effect } from 'effect';
import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import type { BirthConflict, BirthInput, BirthRefused } from '@runlith/agent/collaboration/threads';
import type { RootBinding } from '../../../workspace/contract/wire/roots.js';
import type { HarnessName } from '../../../threads/contract/wire/harness/names.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { Harness } from '../../../threads/contract/service/harness.js';
import type { HarnessSeat } from '../../../threads/contract/wire/harness/seat.js';

export interface SessionBirths {
  readonly create: Harness['Service']['born'];
  adopt(input: {
    readonly projectId: number;
    readonly harness: HarnessName;
    readonly key: string;
    readonly mode: AgentApprovalMode;
    readonly place?: RootBinding;
  }): Effect.Effect<{ readonly threadId: string; readonly born: boolean }, HarnessFailure>;
  transportAt(name: HarnessName, projectId: number, preferred: ThreadModelSelection | null): Effect.Effect<HarnessSeat, HarnessFailure>;
  born(
    input: BirthInput,
  ): Effect.Effect<{ readonly threadId: string; readonly acted: boolean }, HarnessFailure | BirthConflict | BirthRefused>;
}
