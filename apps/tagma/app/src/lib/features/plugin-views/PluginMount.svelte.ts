import { Scope } from '@runlith/layer/Scope';
import { Screen } from '@runlith/layer/svelte/screen.svelte';
import { ThreadPresence } from '$lib/features/presence/Presence.svelte.js';
import { ShellOps, type ShellPort } from '$lib/features/workspace/ShellOps.js';
import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
import { Theme } from '$lib/shared/Theme.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { SoundChannel } from '$lib/wire/SoundChannel.js';
import { ViewCapabilities } from './capabilities.js';
import { type ClientOwners, makeClient, type MountFacts, type TagmaClient } from './client.svelte.js';
import { ThreadTranscripts } from './ThreadTranscripts.js';
import { ViewSets } from './ViewSets.svelte.js';

type MountOptions = { readonly facts: MountFacts; readonly shell: ShellPort | undefined };

export class PluginMount extends Screen<PluginMount, MountOptions>()('PluginMount', { tier: 'project' }) {
  static override *make(options: MountOptions) {
    const owners: ClientOwners = {
      door: yield* Door,
      live: yield* Live,
      sound: yield* SoundChannel,
      presence: yield* ThreadPresence,
      transcripts: yield* ThreadTranscripts,
      shell: options.shell ?? (yield* ShellOps),
      sets: yield* ViewSets,
      links: yield* ExternalLinks,
      theme: yield* Theme,
      capabilities: (yield* ViewCapabilities).items,
    };
    return new PluginMount(owners, options.facts, yield* Scope);
  }

  readonly client: TagmaClient;

  constructor(owners: ClientOwners, facts: MountFacts, scope: Scope) {
    super();
    const ended = new AbortController();
    scope.defer(() => ended.abort('the view was unmounted'));
    this.client = makeClient(owners, facts, ended.signal);
  }
}
