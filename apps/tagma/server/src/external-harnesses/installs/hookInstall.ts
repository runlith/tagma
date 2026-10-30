import { entryLine } from '../../installation/contract/wire/junction.js';
import { PERMISSION_TIMEOUT_SECONDS } from '../contract/wire/call.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HookAsset, HookEvents, HookSurface } from '@runlith/tagma/adapter/harness';
import type { HookCodec } from '@runlith/tagma/adapter/hook';

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

type HookFile = { file: string; codec: HookCodec; entries: HookEntry[]; assets: readonly HookAsset[] };

type HookGroup = { readonly file: string; readonly codec: HookCodec; readonly adapters: readonly HarnessAdapter[] };

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

export function hookGroups(adapters: readonly HarnessAdapter[], key: (surface: HookSurface) => string): HookGroup[] {
  const byKey = new Map<string, Map<HookCodec, { file: string; codec: HookCodec; adapters: HarnessAdapter[] }>>();
  const groups: { file: string; codec: HookCodec; adapters: HarnessAdapter[] }[] = [];
  for (const adapter of adapters) {
    const surface = adapter.hooks;
    if (surface === null) continue;
    const at = key(surface);
    let codecs = byKey.get(at);
    if (codecs === undefined) {
      codecs = new Map();
      byKey.set(at, codecs);
    }
    const group = codecs.get(surface.codec);
    if (group === undefined) {
      const made = { file: surface.file, codec: surface.codec, adapters: [adapter] };
      codecs.set(surface.codec, made);
      groups.push(made);
    } else group.adapters.push(adapter);
  }
  return groups;
}

export function hookFiles(adapters: readonly HarnessAdapter[]): HookFile[] {
  return hookGroups(adapters, (surface) => surface.file).map((group) => ({
    file: group.file,
    codec: group.codec,
    entries: entriesOf(group.adapters),
    assets: group.adapters.flatMap((adapter) => adapter.hooks?.assets ?? []),
  }));
}
