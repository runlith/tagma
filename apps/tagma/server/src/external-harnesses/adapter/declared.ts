import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { LEGACY_TOOLS, type AcpProfile, type TerminalSurface } from '@runlith/tagma/adapter/harness';
import type { HarnessAdapter } from '../contract/service/adapter.js';

const ACP_ONLY: Omit<TerminalSurface, 'launch' | 'binary' | 'prefix'> = {
  tools: LEGACY_TOOLS,
  hooks: null,
  mcpTools: 'catalog',
  mcp: null,
  occasionOf: () => 'activity',
  sessionKeyOf: () => null,
  modelOf: () => null,
  reportsModel: false,
  turnOf: () => null,
  answerKey: null,
  subjectOf: () => null,
  filesOf: () => [],
  printedOf: () => null,
  eventKeys: [],
  screenAskOf: () => null,
  keysOf: () => null,
  cancelKeysOf: () => null,
  interrupt: null,
  steer: 'none',
  quit: null,
  callEnvelopeMs: null,
  ends: { interrupt: 'record', idle: null, tail: 'final' },
};

const markOf = (provider: HarnessProvider): string | undefined => provider.mark ?? provider.icon;

const labelOf = (provider: HarnessProvider): string => provider.harnessLabel ?? provider.label;

const declaredEnv = (provider: HarnessProvider): Record<string, string> =>
  provider.auth === 'cli'
    ? Object.fromEntries(provider.environment(null).flatMap((entry) => (entry._tag === 'Set' ? [[entry.name, entry.value]] : [])))
    : {};

const acpOnly = (provider: HarnessProvider, acp: AcpProfile): HarnessAdapter => ({
  harness: provider.id,
  label: labelOf(provider),
  mark: markOf(provider),
  prefix: provider.id,
  binary: acp.program ?? acp.argv(undefined)[0] ?? provider.id,
  ...ACP_ONLY,
  env: declaredEnv(provider),
  launch: null,
  acp,
});

export const declaredHarness = (provider: HarnessProvider): HarnessAdapter | null => {
  const { terminal, acp } = provider;
  if (terminal === undefined) return acp === undefined ? null : acpOnly(provider, acp);
  return { harness: provider.id, label: labelOf(provider), mark: markOf(provider), ...terminal, acp };
};
