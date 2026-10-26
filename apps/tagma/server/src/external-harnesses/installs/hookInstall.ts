import { HARNESSES } from '../contract/service/table.js';
import { entryLine } from '../../installation/contract/wire/junction.js';
import { PERMISSION_TIMEOUT_SECONDS } from '../contract/wire/call.js';
import type { HarnessAdapter, HookAsset, HookEvents, HookFormat, HookSurface } from '../contract/service/adapter.js';

export type HooksWrite = { path: string; write: 'created' | 'updated' | 'current'; deferred?: string[] };

type HookVerb = { readonly verb: string; readonly timeout?: number };

const HOOK_VERBS: Partial<Record<keyof HookEvents, HookVerb>> = {
  sessionStart: { verb: 'session-start' },
  preWrite: { verb: 'pre-tool-use' },
  postWrite: { verb: 'post-tool-use' },
  postRead: { verb: 'post-tool-use' },
  stop: { verb: 'stop' },
  agentResponse: { verb: 'answer' },
  permission: { verb: 'permission-request', timeout: PERMISSION_TIMEOUT_SECONDS },
  prompt: { verb: 'observe' },
  sessionEnd: { verb: 'observe' },
  toolFailure: { verb: 'observe' },
  stopFailure: { verb: 'observe' },
  notification: { verb: 'observe' },
};

export type HookEntry = { event: string; command: string; timeout?: number };

type HookFile = { file: string; format: HookFormat; entries: HookEntry[]; assets: readonly HookAsset[] };

type HookGroup = { readonly file: string; readonly format: HookFormat; readonly adapters: readonly HarnessAdapter[] };

const hookCommand = (verb: string, served: readonly HarnessAdapter[]): string =>
  entryLine(served.length === 1 ? `hook ${verb} --harness ${served[0]!.harness}` : `hook ${verb}`);

export function entriesOf(served: readonly HarnessAdapter[]): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const adapter of served) {
    const events = adapter.hooks?.events;
    if (events === undefined) continue;
    for (const [occasion, asked] of Object.entries(HOOK_VERBS)) {
      const event = events[occasion as keyof HookEvents];
      if (event === null || event === undefined) continue;
      const command = hookCommand(asked.verb, served);
      if (entries.some((held) => held.event === event && held.command === command)) continue;
      entries.push({ event, command, timeout: asked.timeout });
    }
  }
  return entries;
}

export function hookGroups(key: (surface: HookSurface) => string): HookGroup[] {
  const byKey = new Map<string, { file: string; format: HookFormat; adapters: HarnessAdapter[] }>();
  for (const adapter of HARNESSES) {
    const surface = adapter.hooks;
    if (surface === null) continue;
    const group = byKey.get(key(surface)) ?? { file: surface.file, format: surface.format, adapters: [] };
    byKey.set(key(surface), group);
    group.adapters.push(adapter);
  }
  return [...byKey.values()];
}

export function hookFiles(): HookFile[] {
  return hookGroups((surface) => surface.file).map((group) => ({
    file: group.file,
    format: group.format,
    entries: entriesOf(group.adapters),
    assets: group.adapters.flatMap((adapter) => adapter.hooks?.assets ?? []),
  }));
}
