import { Scope } from '@runlith/layer/Scope';
import { Screen } from '@runlith/layer/svelte/screen.svelte';
import { ThreadPresence } from '$lib/features/presence/Presence.svelte.js';
import { ShellOps, type ShellPort } from '$lib/features/workspace/ShellOps.js';
import { ExternalLinks, type LinkPort } from '$lib/shared/ExternalLinks.js';
import { Theme, type ThemePort } from '$lib/shared/Theme.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { type ViewCapability, ViewCapabilities } from './capabilities.js';
import { makeClient, type MountFacts, type TagmaClient } from './client.svelte.js';
import { ThreadTranscripts, type TranscriptPort } from './ThreadTranscripts.js';
import { ViewSets } from './ViewSets.svelte.js';

type MountOptions = { readonly facts: MountFacts; readonly shell: ShellPort | undefined };

export class PluginMount extends Screen<PluginMount, MountOptions>()('PluginMount', { tier: 'project' }) {
  static override *make(options: MountOptions) {
    return new PluginMount(
      yield* Door,
      yield* Live,
      yield* ThreadPresence,
      yield* ThreadTranscripts,
      options.shell ?? (yield* ShellOps),
      yield* ViewSets,
      yield* ExternalLinks,
      yield* Theme,
      (yield* ViewCapabilities).items,
      options.facts,
      yield* Scope,
    );
  }

  readonly client: TagmaClient;

  constructor(
    door: Door,
    live: LiveConnection,
    presence: ThreadPresence,
    transcripts: TranscriptPort,
    shell: ShellPort,
    sets: ViewSets,
    links: LinkPort,
    theme: ThemePort,
    capabilities: readonly ViewCapability[],
    facts: MountFacts,
    scope: Scope,
  ) {
    super();
    const ended = new AbortController();
    scope.defer(() => ended.abort('the view was unmounted'));
    this.client = makeClient(door, live, presence, transcripts, shell, sets, links, theme, capabilities, facts, ended.signal);
  }
}
