import type {
  Transport,
  TransportAsks,
  TransportCompaction,
  TransportHistory,
  TransportResource,
  TransportRuns,
} from '@runlith/agent/thread/transport/contract';

export const acpTransport = (
  asks: TransportAsks,
  runs: TransportRuns,
  resource: TransportResource,
  history: TransportHistory,
  compaction: TransportCompaction,
): Transport => ({
  adapter: 'acp',
  declares: { history: 'session', compaction: 'session' },
  words: 'receipt',
  runs,
  asks,
  history,
  compaction,
  resource,
});
