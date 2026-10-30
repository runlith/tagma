import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import type { AcpProfile, TerminalSurface } from '@runlith/tagma/adapter/harness';
import type { HarnessAdapter } from '../contract/service/adapter.js';

const ACP_ONLY: Omit<TerminalSurface, 'launch' | 'binary' | 'prefix'> = {
  tools: { names: 'vendor', byName: {} },
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

const acpOnly = (provider: HarnessProvider, acp: AcpProfile): HarnessAdapter => ({
  harness: provider.id,
  label: provider.label,
  iconProvider: provider.icon,
  mark: provider.mark,
  prefix: provider.id,
  binary: acp.argv(undefined)[0] ?? provider.id,
  ...ACP_ONLY,
  launch: null,
  acp,
});

export const declaredHarness = (provider: HarnessProvider): HarnessAdapter | null => {
  const { terminal, acp } = provider;
  if (terminal === undefined) return acp === undefined ? null : acpOnly(provider, acp);
  return { harness: provider.id, label: provider.label, iconProvider: provider.icon, mark: provider.mark, ...terminal, acp };
};
