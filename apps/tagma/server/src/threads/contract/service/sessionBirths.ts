import { Context, type Effect } from 'effect';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import type { BirthConflict, BirthInput } from '@runlith/agent/collaboration/threads';
import type { RootBinding } from '../../../workspace/contract/wire/roots.js';
import type { HarnessSeat } from '../wire/harness/seat.js';
import type { BirthPlace } from '../wire/birth.js';
import type { HarnessName } from '../wire/harness/names.js';
import type { HarnessFailure } from './failure.js';
import type { Harness } from './harness.js';

export class SessionBirthWriting extends Context.Service<SessionBirthWriting, SessionBirthRows>()('tagma/threads/SessionBirthWriting') {}

export interface SessionBirthRows {
  readonly create: Harness['Service']['born'];
  adopt(input: {
    readonly projectId: number;
    readonly harness: HarnessName;
    readonly label: string;
    readonly key: string;
    readonly mode: AgentApprovalMode;
    readonly place?: RootBinding;
    readonly seat: HarnessSeat;
  }): Effect.Effect<{ readonly threadId: string; readonly born: boolean }, HarnessFailure>;
  spawned(
    input: BirthInput,
    seat: HarnessSeat,
    place?: BirthPlace,
  ): Effect.Effect<{ readonly threadId: string; readonly acted: boolean }, HarnessFailure | BirthConflict>;
}
