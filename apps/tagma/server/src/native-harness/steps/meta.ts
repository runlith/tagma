import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

export const isRecord = (value: unknown): value is Record<string, unknown> => Predicate.isObject(value) && !Array.isArray(value);

export type AgentMetaChange = { readonly agentId: unknown; readonly profile: unknown; readonly transport?: Record<string, unknown> };

export type AgentMeta = {
  readonly agentId: unknown;
  readonly transport: Record<string, unknown> | null;
  readonly profile: unknown;
  readonly overlay: Record<string, unknown> | null;
  with(change: AgentMetaChange): Held;
};

export const agentMeta = (meta: Held): AgentMeta | null => {
  const hasRecord = isRecord(meta.record);
  const record = hasRecord ? meta.record : meta.thread;
  if (!isRecord(record)) return null;
  const native = hasRecord ? meta.native : record;
  const transport = isRecord(native) && isRecord(native.transport) ? native.transport : null;
  const profile = isRecord(native) ? native.profile : null;
  const overlay = isRecord(profile) && isRecord(profile.overlay) ? profile.overlay : null;
  return {
    agentId: record.agentId,
    transport,
    profile,
    overlay,
    with: (change) => {
      const nextRecord = { ...record, agentId: change.agentId };
      if (!isRecord(native)) return { ...meta, record: nextRecord };
      const nextNative = { ...native, profile: change.profile, transport: change.transport ?? native.transport };
      return hasRecord
        ? { ...meta, record: nextRecord, native: nextNative }
        : { ...meta, thread: { ...nextNative, agentId: nextRecord.agentId } };
    },
  };
};
