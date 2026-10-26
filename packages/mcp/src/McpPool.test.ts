import { describe, expect, test } from 'bun:test';
import { type McpReconcileLive, mcpReconcileActions } from './McpPool';
import type { McpServerDeclaration, McpStdioServerDeclaration } from './McpServerDeclaration';

const declare = (name: string): McpStdioServerDeclaration => ({
  name,
  transport: 'stdio',
  command: 'server',
  capabilities: { kinds: ['read'], mutates: false },
  enabled: true,
});
const live = (entries: readonly (readonly [McpServerDeclaration, McpReconcileLive['status']])[]) =>
  new Map(entries.map(([declaration, status]) => [declaration.name, { declaration, status }]));

describe('mcpReconcileActions', () => {
  const files = declare('files');
  const search = declare('search');
  test('removes declarations no longer named and starts newly named ones', () => {
    expect(mcpReconcileActions(live([[files, 'connected']]), [search])).toEqual([
      { kind: 'remove', name: 'files' },
      { kind: 'start', declaration: search },
    ]);
  });
  test('leaves connecting and connected servers under equal declarations alone', () => {
    expect(mcpReconcileActions(live([[files, 'connected']]), [{ ...files }])).toEqual([]);
    expect(mcpReconcileActions(live([[files, 'connecting']]), [{ ...files }])).toEqual([]);
  });
  test('restarts changed declarations and failed servers', () => {
    const reclassified: McpServerDeclaration = { ...files, capabilities: { kinds: ['write'], mutates: true } };
    expect(mcpReconcileActions(live([[files, 'connected']]), [reclassified])).toEqual([{ kind: 'start', declaration: reclassified }]);
    expect(mcpReconcileActions(live([[files, 'failed']]), [files])).toEqual([{ kind: 'start', declaration: files }]);
  });
  test('disables a declaration once and starts it again when re-enabled', () => {
    const silenced: McpServerDeclaration = { ...files, enabled: false };
    expect(mcpReconcileActions(live([[files, 'connected']]), [silenced])).toEqual([{ kind: 'disable', declaration: silenced }]);
    expect(mcpReconcileActions(live([[silenced, 'disabled']]), [silenced])).toEqual([]);
    expect(mcpReconcileActions(new Map(), [silenced])).toEqual([{ kind: 'disable', declaration: silenced }]);
    expect(mcpReconcileActions(live([[silenced, 'disabled']]), [files])).toEqual([{ kind: 'start', declaration: files }]);
  });
});
