import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
import { appendedFrom } from './appended';
import type { ChatEntryOf } from './renderers';
import {
  type BuiltinDefault,
  type BuiltinKindName,
  createEntryKinds,
  type EntryKinds,
  type EntryRenderer,
  type EntryTraits,
} from './EntryKinds.svelte';
import { ATTACHMENTS_PX, BODY_COLUMNS, BUBBLE_PX, DISCLOSURE_BODY_PX, DISCLOSURE_PX, META_PX, STEP_PX, USER_COLUMNS } from './rowEstimate';

export type BuiltinRenderers = { [K in BuiltinKindName]?: EntryRenderer<ChatEntryOf<K>> };

const BUILTIN = 'chat-ui builtin kinds';
const VERBOSE_ONLY: EntryTraits = { verboseOnly: true };
const META: EntryTraits = { meta: true };

function builtin<K extends BuiltinKindName>(
  kind: K,
  render: BuiltinRenderers,
  rest: Omit<BuiltinDefault<K>, 'kind' | 'render'> = {},
): BuiltinDefault<K> {
  const renderer = render[kind] as EntryRenderer<ChatEntryOf<K>> | undefined;
  return { kind, ...rest, render: renderer };
}

export function registerBuiltinKinds(kinds: EntryKinds, render: BuiltinRenderers = {}): () => void {
  const disposers = [
    kinds.registerDefault(
      BUILTIN,
      builtin('assistant', render, {
        estimate: (entry, view) => view.markdown(entry.id, entry.text, BODY_COLUMNS, appendedFrom(entry)) + META_PX,
      }),
    ),
    kinds.registerDefault(
      BUILTIN,
      builtin('reasoning', render, {
        classify: () => META,
        estimate: (entry, view) => view.markdown(entry.id, entry.text, BODY_COLUMNS, appendedFrom(entry)),
      }),
    ),
    kinds.registerDefault(
      BUILTIN,
      builtin('user', render, {
        estimate: (entry, view) =>
          view.markdown(entry.id, entry.text, USER_COLUMNS) + BUBBLE_PX + META_PX + (entry.attachments?.length ? ATTACHMENTS_PX : 0),
      }),
    ),
    kinds.registerDefault(
      BUILTIN,
      builtin('context', render, {
        classify: () => VERBOSE_ONLY,
        estimate: (entry, view) => DISCLOSURE_PX + (view.expanded(entry.id, false) ? DISCLOSURE_BODY_PX : 0),
      }),
    ),
    kinds.registerDefault(
      BUILTIN,
      builtin('system-prompt', render, {
        classify: () => VERBOSE_ONLY,
        estimate: (entry, view) => DISCLOSURE_PX + (view.expanded(entry.id, false) ? DISCLOSURE_BODY_PX : 0),
      }),
    ),
    kinds.registerDefault(BUILTIN, builtin('compaction', render, { classify: () => META, estimate: () => STEP_PX })),
    kinds.registerDefault(BUILTIN, builtin('run-end', render, { estimate: () => STEP_PX })),
    kinds.registerDefault(BUILTIN, builtin('runtime-guidance', render, { classify: () => ({ meta: true, verboseOnly: true }) })),
    kinds.registerDefault(BUILTIN, builtin('ready-answers', render, { classify: () => VERBOSE_ONLY })),
    kinds.registerDefault(BUILTIN, builtin('tool', render, { classify: () => ({ meta: true, rail: true }) })),
    kinds.registerDefault(
      BUILTIN,
      builtin('signal', render, {
        classify: (entry) => {
          if (entry.addressee !== 'transport') return {};
          return { meta: true, rail: true, verboseOnly: entry.signalType === KEEP_WARM_SIGNAL_TYPE ? undefined : (true as const) };
        },
      }),
    ),
    kinds.registerDefault(
      BUILTIN,
      builtin('words', render, {
        estimate: (entry, view) =>
          view.markdown(entry.id, entry.text, USER_COLUMNS) +
          BUBBLE_PX +
          META_PX +
          (entry.sender === null ? 0 : META_PX) +
          (entry.attachments?.length ? ATTACHMENTS_PX : 0),
      }),
    ),
    kinds.registerDefault(BUILTIN, builtin('error', render)),
    kinds.registerDefault(BUILTIN, builtin('unreadable', render)),
    kinds.registerDefault(BUILTIN, builtin('interruption', render)),
    kinds.registerDefault(BUILTIN, builtin('restart', render)),
    kinds.registerDefault(BUILTIN, builtin('question', render)),
    kinds.registerDefault(BUILTIN, builtin('retry', render)),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

export function builtinEntryKinds(): EntryKinds {
  const kinds = createEntryKinds();
  registerBuiltinKinds(kinds);
  return kinds;
}
