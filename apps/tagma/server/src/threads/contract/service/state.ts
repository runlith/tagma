import type { ThreadSpawnDepth } from '@runlith/agent/collaboration/ThreadSpawnAccess';
import type { ThreadSnapshotOf } from '@runlith/agent/transcript/live';
import type { ThreadState } from '@runlith/agent/thread/state';
import type { ApprovalModeView } from '@runlith/agent/modes/ApprovalMode';
import type { ExternalSession } from '../wire/harness/externalSession.js';
import type { Approving } from '../wire/approving.js';
import type { Delegation, ThreadPlace } from '../wire/birth.js';
import type { RecapAttempt, RecapReading } from '../wire/recap.js';
import type { PinnedView } from '../wire/pins.js';
import type { ThreadParent } from '../wire/snapshot.js';

export type NativeThreadState = ThreadState & {
  readonly home: number | null;
  readonly title: string;
  readonly parent?: ThreadParent;
  readonly detachedFrom?: ThreadParent;
  readonly harness: ExternalSession | null;
  readonly delegation: Delegation;
  readonly approving: Approving;
  readonly spawnDepth: ThreadSpawnDepth;
  readonly place: ThreadPlace | null;
  readonly recap: RecapReading | null;
  readonly recapAttempt: RecapAttempt | null;
  readonly modes: readonly ApprovalModeView[];
  readonly pins: readonly PinnedView[];
};

export type NativeThreadSnapshot = ThreadSnapshotOf<NativeThreadState>;
