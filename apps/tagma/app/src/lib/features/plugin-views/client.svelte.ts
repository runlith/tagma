import type { McpAppCallResult } from '@runlith/mcp/apps';
import { TagmaRefused } from '@runlith/tagma/plugin';
import type { PresenceMissingReason, PresenceRow } from '@tagma/server/threads/contract/wire/presence';
import { Cause, Effect, Exit } from 'effect';
import { createSubscriber } from 'svelte/reactivity';
import type { ThreadPresence } from '$lib/features/presence/Presence.svelte.js';
import type { ShellPort, ShellRefusal } from '$lib/features/workspace/ShellOps.js';
import type { LinkPort } from '$lib/shared/ExternalLinks.js';
import type { Look, ThemePort } from '$lib/shared/Theme.js';
import { Refusal } from '$lib/wire/refusal.js';
import type { CapabilityOwners, ViewCapability } from './capabilities.js';
import { paneId, PLUGIN_PANE } from './panes.js';
import { sectionSurface } from './surfaces.js';
import type { TranscriptPort } from './ThreadTranscripts.js';
import { type Transcript, transcriptReading } from './transcriptReading.svelte.js';
import type { ViewSets } from './ViewSets.svelte.js';

export type MountFacts = {
  readonly projectId: number;
  readonly plugin: string;
  readonly view: string;
  readonly threadId: string | null;
  readonly key: string | null;
};

export type ClientOwners = CapabilityOwners & {
  readonly presence: ThreadPresence;
  readonly transcripts: TranscriptPort;
  readonly shell: ShellPort;
  readonly sets: ViewSets;
  readonly links: LinkPort;
  readonly theme: ThemePort;
  readonly capabilities: readonly ViewCapability[];
};

export type ThreadReading =
  | {
      readonly threadId: string;
      readonly life: PresenceRow['status']['life'];
      readonly runId: string | null;
      readonly text: string | null;
      readonly ended: string | null;
    }
  | { readonly threadId: string; readonly missing: PresenceMissingReason };

export type ViewOpening =
  | { readonly threadId: string; readonly beside?: boolean }
  | { readonly section: string }
  | { readonly pane: string };

export type Reading<A> = { readonly current: A; readonly failure: string | null };

export type ViewStorage = {
  get(key: string): Promise<{ readonly stored: boolean; readonly value?: unknown }>;
  set(key: string, value?: unknown): Promise<boolean>;
};

export type TagmaClient = MountFacts & {
  readonly tools: Readonly<Record<string, (input?: Readonly<Record<string, unknown>>) => Promise<unknown>>>;
  readonly storage: ViewStorage;
  readonly theme: Look;
  resource(uri: string): Reading<unknown>;
  thread(threadId: string): Reading<ThreadReading | null>;
  transcript(threadId: string): Transcript;
  open(opening: ViewOpening): Promise<void>;
  openLink(url: string): void;
  readonly [capability: string]: unknown;
};

const readingOf = (threadId: string, row: PresenceRow | undefined, missing: PresenceMissingReason | undefined): ThreadReading | null => {
  if (row === undefined) return missing === undefined ? null : { threadId, missing };
  return {
    threadId,
    life: row.status.life,
    runId: row.status.runId,
    text: row.tail?.text ?? row.saidLine,
    ended: row.status.runId === null ? (row.outcome?.status ?? null) : null,
  };
};

const refusedBy = (operation: string, caught: unknown): Error =>
  caught instanceof Refusal ? new TagmaRefused(operation, caught.code, caught.reason, caught.unblock) : (caught as Error);

const textOf = (result: McpAppCallResult): string =>
  (result.content ?? []).flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])).join('');

const parsed = (text: string): unknown => {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const valueOf = (contents: readonly Readonly<Record<string, unknown>>[]): unknown => {
  const [first] = contents;
  if (first === undefined || typeof first.text !== 'string') return first;
  return first.mimeType === 'application/json' ? parsed(first.text) : first.text;
};

const acted = (act: Effect.Effect<void, ShellRefusal>): Promise<void> =>
  Effect.runPromiseExit(act).then((exit) => {
    if (Exit.isSuccess(exit)) return;
    const failure = Cause.squash(exit.cause);
    throw new Error(failure instanceof Error ? failure.message : String(failure));
  });

export function makeClient(owners: ClientOwners, facts: MountFacts, ended: AbortSignal): TagmaClient {
  const { door, live, presence, transcripts, shell, sets, links, theme } = owners;
  const lens = { project: String(facts.projectId) };
  const at = { plugin: facts.plugin, view: facts.view };
  const cached = <A>(held: Map<string, A>, key: string, make: () => A): A => {
    const standing = held.get(key);
    if (standing !== undefined) return standing;
    const made = make();
    held.set(key, made);
    return made;
  };

  const call = async (tool: string, input: Readonly<Record<string, unknown>> = {}): Promise<unknown> => {
    const answer = await door
      .perform('call_plugin_tool', { ...at, tool, arguments: input, threadId: facts.threadId ?? undefined }, lens, { signal: ended })
      .catch((caught: unknown) => {
        throw refusedBy('call_plugin_tool', caught);
      });
    if (answer.status !== 'ok') throw new Error(`call_plugin_tool answered ${answer.status}`);
    const { result } = answer;
    if (result.isError === true) throw new TagmaRefused('call_plugin_tool', 'plugin-tool-failed', textOf(result), []);
    return result.structuredContent ?? parsed(textOf(result));
  };

  const tools = new Proxy({} as TagmaClient['tools'], {
    get: (_target, name) => (typeof name === 'string' ? (input?: Readonly<Record<string, unknown>>) => call(name, input) : undefined),
  });

  const resources = new Map<string, Reading<unknown>>();
  const resource = (uri: string): Reading<unknown> =>
    cached(resources, uri, () => {
      let value = $state.raw<unknown>(undefined);
      let failure = $state<string | null>(null);
      const subscribe = createSubscriber(() => {
        const reading = new AbortController();
        const read = () =>
          door.perform('read_plugin_resource', { ...at, uri }, lens, { signal: reading.signal }).then(
            (answer) => {
              if (answer.status !== 'ok') return;
              value = valueOf(answer.contents);
              failure = null;
            },
            (caught: unknown) => {
              if (!reading.signal.aborted) failure = caught instanceof Error ? caught.message : String(caught);
            },
          );
        const held = live.hold(
          (client) => client['views.resource.subscribe']({ projectId: facts.projectId, ...at, uri }),
          () => void read(),
          (refused) => {
            failure = refused.message;
          },
        );
        return () => {
          reading.abort();
          held.unsubscribe();
        };
      });
      return {
        get current() {
          subscribe();
          return value;
        },
        get failure() {
          subscribe();
          return failure;
        },
      };
    });

  const threads = new Map<string, Reading<ThreadReading | null>>();
  const thread = (threadId: string): Reading<ThreadReading | null> =>
    cached(threads, threadId, () => {
      let hold: ReturnType<ThreadPresence['watch']> | null = null;
      const subscribe = createSubscriber(() => {
        const made = presence.watch([threadId]);
        hold = made;
        return () => {
          made.release();
          if (hold === made) hold = null;
        };
      });
      return {
        get current() {
          subscribe();
          return hold === null ? null : readingOf(threadId, hold.set.row(threadId), hold.set.missing(threadId));
        },
        get failure() {
          subscribe();
          return hold?.set.problem ?? null;
        },
      };
    });

  const followed = new Map<string, Transcript>();
  const transcript = (threadId: string): Transcript =>
    cached(followed, threadId, () => transcriptReading(transcripts, facts.projectId, threadId));

  const open = (opening: ViewOpening): Promise<void> => {
    if ('section' in opening) {
      if (sets.surface(facts.plugin, opening.section) === undefined)
        return Promise.reject(new Error(`the plugin ${facts.plugin} contributes no section ${opening.section}`));
      return acted(shell.revealSurface(sectionSurface(facts.plugin, opening.section)));
    }
    if ('pane' in opening) {
      if (sets.pane(facts.plugin, opening.pane) === undefined)
        return Promise.reject(new Error(`the plugin ${facts.plugin} contributes no pane ${opening.pane}`));
      return acted(shell.openPane(PLUGIN_PANE, paneId(facts.plugin, opening.pane)));
    }
    return acted(shell.openThread({ projectId: facts.projectId, threadId: opening.threadId }, opening.beside === true ? 'beside' : 'main'));
  };

  const storage: ViewStorage = {
    get: async (key) => {
      const read = await door.perform('read_view_storage', { ...at, key }, lens, { signal: ended }).catch((caught: unknown) => {
        throw refusedBy('read_view_storage', caught);
      });
      if (read.status !== 'ok') throw new Error(`read_view_storage answered ${read.status}`);
      return read.stored ? { stored: true, value: read.value } : { stored: false };
    },
    set: async (key, value) => {
      const written = await door.perform('write_view_storage', { ...at, key, value }, lens, { signal: ended }).catch((caught: unknown) => {
        throw refusedBy('write_view_storage', caught);
      });
      if (written.status !== 'ok') throw new Error(`write_view_storage answered ${written.status}`);
      return written.stored;
    },
  };

  const contributed = Object.fromEntries(
    owners.capabilities.map((capability) => [
      capability.declaration.id,
      capability.make(owners, { ...at, projectId: facts.projectId, ended }),
    ]),
  );

  return {
    ...contributed,
    ...facts,
    tools,
    storage,
    get theme() {
      return theme.look;
    },
    resource,
    thread,
    transcript,
    open,
    openLink: (url) => links.open(url),
  };
}
