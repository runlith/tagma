import type {
  Transport,
  TransportAsks,
  TransportHistory,
  TransportResource,
  TransportRuns,
} from '@runlith/agent/thread/transport/contract';

export const terminalTransport = (
  runs: TransportRuns,
  resource: TransportResource,
  asks: TransportAsks,
  history: TransportHistory,
): Transport => ({
  adapter: 'terminal',
  declares: { history: 'session', compaction: 'none' },
  words: 'receipt',
  runs,
  asks,
  resource,
  history,
});
