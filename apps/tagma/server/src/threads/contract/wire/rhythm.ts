import type { ThreadRunLeaseRhythm } from '@runlith/agent/thread/ThreadPorts';
import type { ThreadRunReaperRhythm } from '@runlith/agent/thread/ThreadPorts';
import type { ThreadSettlementOutboxRhythm } from '@runlith/agent/thread/ThreadPorts';

const HEARTBEAT_MS = 5_000;

export const RECAP_WAIT_MS = 5 * 60_000;

export const RECAP_MARGIN_MS = 60_000;

export const STALL_SWEEP_INTERVAL_MS = HEARTBEAT_MS * 12;

export const LEASE_RHYTHM: ThreadRunLeaseRhythm = {
  heartbeatIntervalMs: HEARTBEAT_MS,
  staleRunningAfterMs: HEARTBEAT_MS * 120,
  takeoverAfterMs: HEARTBEAT_MS * 3,
};

export const RECONCILE_INTERVAL_MS = LEASE_RHYTHM.heartbeatIntervalMs;

export const REAPER_RHYTHM: ThreadRunReaperRhythm = {
  staleSweepIntervalMs: HEARTBEAT_MS * 12,
  recoveryBatch: 100,
  resumeWithinMs: 20 * 60_000,
  resumeAttemptLimit: 2,
};

export const SETTLEMENT_RHYTHM: ThreadSettlementOutboxRhythm = {
  settledClaimAfterMs: HEARTBEAT_MS * 12,
  settledHeartbeatIntervalMs: HEARTBEAT_MS * 4,
  settledNotificationBatch: 100,
  settledNotifyAttemptLimit: 3,
};
