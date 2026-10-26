import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

const renameFields = (value: unknown, fields: readonly string[], from: string, to: string): unknown => {
  if (!isRecord(value)) return value;
  let renamed = value;
  for (const field of fields) {
    if (value[field] === from) renamed = { ...renamed, [field]: to };
  }
  return renamed;
};

const renameType = (value: unknown, fields: readonly string[]): unknown =>
  renameFields(value, fields, 'harness:claude', 'harness:claude-code');

const renameProfile = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const profile = renameType(value, ['id']) as Held;
  const overlay = renameType(value.overlay, ['id', 'baseAgentId']);
  return overlay === value.overlay ? profile : { ...profile, overlay };
};

const renameDefinition = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const definition = renameType(value, ['agentId']) as Held;
  const profile = renameProfile(value.profile);
  return profile === value.profile ? definition : { ...definition, profile };
};

const renameNative = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const transport = renameType(renameFields(value.transport, ['profile'], 'claude', 'claude-code'), ['agent']);
  const profile = renameProfile(value.profile);
  const pendingDefinition = renameDefinition(value.pendingDefinition);
  return transport === value.transport && profile === value.profile && pendingDefinition === value.pendingDefinition
    ? value
    : { ...value, transport, profile, pendingDefinition };
};

const renameExternal = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const facet = renameFields(value.facet, ['name'], 'claude', 'claude-code');
  return facet === value.facet ? value : { ...value, facet };
};

export const claudeCodeHarnessForm: ThreadFormStep = {
  name: '20261018173000_claude_code_harness',
  samples: {
    meta: {
      record: { harness: 'claude', agentId: 'harness:claude' },
      native: { transport: { adapter: 'terminal', profile: 'claude', agent: null }, profile: null },
      external: { facet: { name: 'claude' } },
      opener: { harness: 'claude', key: 'opened-by-cli' },
    },
  },
  meta: (meta) => {
    const record = renameType(renameFields(meta.record, ['harness'], 'claude', 'claude-code'), ['agentId']);
    const native = renameNative(meta.native);
    const external = renameExternal(meta.external);
    const opener = renameFields(meta.opener, ['harness'], 'claude', 'claude-code');
    const thread = renameNative(renameType(renameFields(meta.thread, ['harness'], 'claude', 'claude-code'), ['agentId']));
    const facet = isRecord(meta.facet)
      ? { ...meta.facet, harness: renameFields(meta.facet.harness, ['name'], 'claude', 'claude-code') }
      : meta.facet;
    const session = renameFields(meta.session, ['harness'], 'claude', 'claude-code');
    if (
      record === meta.record &&
      native === meta.native &&
      external === meta.external &&
      opener === meta.opener &&
      thread === meta.thread &&
      (!isRecord(meta.facet) || (isRecord(facet) && facet.harness === meta.facet.harness)) &&
      session === meta.session
    )
      return null;
    return { ...meta, record, native, external, opener, thread, facet, session };
  },
};
