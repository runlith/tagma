import type { EntryRow } from '@tagma/server/marketplaces/contract/wire/rows';
import type { McpServerRow } from '@tagma/server/mcp/contract/wire/servers';
import { type PluginProcessRow, type PluginRow, PROVIDER_FAULTS } from '@tagma/server/plugins/contract/wire/rows';

export type HereState = 'waits' | 'fails' | 'connecting' | 'update' | 'ok' | 'off';

export type StepTone = 'busy' | 'waits' | 'fails' | 'done' | 'idle';

export type Here =
  | {
      readonly kind: 'plugin';
      readonly key: string;
      readonly title: string;
      readonly row: PluginRow;
      readonly servers: readonly McpServerRow[];
      readonly state: HereState;
      readonly newer: string | null;
    }
  | { readonly kind: 'server'; readonly key: string; readonly title: string; readonly row: McpServerRow; readonly state: HereState };

const ORDER: Readonly<Record<HereState, number>> = { waits: 0, fails: 1, connecting: 2, update: 3, ok: 3, off: 4 };

export function serverState(row: McpServerRow): HereState {
  switch (row.status) {
    case 'needs-sign-in':
    case 'needs-value':
      return 'waits';
    case 'failed':
      return 'fails';
    case 'connecting':
      return 'connecting';
    case 'disabled':
    case 'declined':
      return 'off';
    case 'pending':
    case 'connected':
      return 'ok';
  }
}

export const waitsOnSignIn = (row: McpServerRow): boolean => row.status === 'needs-sign-in' || row.signIn?.pending === true;

export function serverTone(row: McpServerRow): StepTone {
  const state = serverState(row);
  if (state === 'connecting' || row.signIn?.pending) return 'busy';
  if (state === 'waits') return 'waits';
  if (state === 'fails') return 'fails';
  return row.status === 'connected' ? 'done' : 'idle';
}

function processState(process: PluginProcessRow): HereState {
  switch (process.state) {
    case 'failed':
      return 'fails';
    case 'starting':
      return 'connecting';
    case 'running':
    case 'idle':
    case 'stopped':
      return 'ok';
  }
}

export function newerOf(row: PluginRow, entries: readonly EntryRow[]): string | null {
  const origin = row.origin;
  if (origin === undefined) return null;
  const entry = entries.find((one) => one.marketplace === origin.marketplace && one.name === origin.entry);
  return entry?.version != null && row.version !== null && entry.version !== row.version ? entry.version : null;
}

export const broughtBy = (servers: readonly McpServerRow[], id: string): readonly McpServerRow[] =>
  servers.filter((row) => row.scope === 'contributed' && row.contributor === id);

export const stillWorking = (row: PluginRow): boolean => row.process?.state === 'running' || row.process?.state === 'idle';

export const processShown = (row: PluginRow): PluginProcessRow | undefined =>
  row.process !== undefined && (row.process.state === 'failed' || row.components.some((component) => component.kind === 'process'))
    ? row.process
    : undefined;

const PROVIDER_POINTS: ReadonlySet<string> = new Set(Object.values(PROVIDER_FAULTS));

export const onlyProviders = (row: PluginRow): boolean =>
  row.providers !== undefined && row.process === undefined && row.components.length === 0;

export function pluginState(row: PluginRow, servers: readonly McpServerRow[], newer: string | null): HereState {
  if (row.refused !== undefined && !stillWorking(row)) return 'fails';
  if (row.off) return 'off';
  if (row.faults.some((fault) => PROVIDER_POINTS.has(fault.point))) return 'fails';
  if (!row.enabled && row.providers === undefined) return 'off';
  const states = [...servers.map(serverState), ...(row.process === undefined ? [] : [processState(row.process)])];
  if (states.includes('waits') || row.options.some((option) => option.required && !option.set)) return 'waits';
  if (states.includes('fails')) return 'fails';
  if (states.includes('connecting')) return 'connecting';
  return newer === null ? 'ok' : 'update';
}

export function hereOf(plugins: readonly PluginRow[], servers: readonly McpServerRow[], entries: readonly EntryRow[]): readonly Here[] {
  const items: Here[] = [
    ...plugins.map((row): Here => {
      const own = broughtBy(servers, row.id);
      const newer = newerOf(row, entries);
      return {
        kind: 'plugin',
        key: `plugin/${row.id}`,
        title: row.title ?? row.id,
        row,
        servers: own,
        state: pluginState(row, own, newer),
        newer,
      };
    }),
    ...servers
      .filter((row) => row.scope !== 'contributed')
      .map((row): Here => ({ kind: 'server', key: `server/${row.scope}/${row.name}`, title: row.name, row, state: serverState(row) })),
  ];
  return items.toSorted((left, right) => ORDER[left.state] - ORDER[right.state] || left.title.localeCompare(right.title));
}
