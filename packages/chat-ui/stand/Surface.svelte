<script lang="ts">
  import { setContext } from 'svelte';
  import ChatSurface from '@feed/ChatSurface.svelte';
  import { ComposerContributions } from '@feed/ComposerContributions.svelte';
  import { createEntryKinds } from '@feed/EntryKinds.svelte';
  import { FeedMemory } from '@feed/FeedMemory';
  import { FeedRegions } from '@feed/FeedRegions.svelte';
  import { PromptHandle } from '@feed/PromptHandle.svelte';
  import type { ChatStrings } from '@feed/strings';
  import type { ChatPreferences } from '@feed/surface';
  import type { ChatButton, ChatCodeBody, ChatKey, ChatMarkdownBody } from '@feed/renderers';
  import Markdown from '@paint';
  import Code from '@code';
  import type { Rig } from './rig.svelte';

  let { rig, touch }: { rig: Rig; touch: boolean } = $props();
  const strings = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'locale' ? 'en' : (...args: unknown[]) => (args.length === 0 ? String(key) : `${String(key)} ${args.join(' ')}`),
    },
  ) as ChatStrings;
  setContext(Symbol.for('runlith.chat-ui.strings'), strings);
  const kinds = createEntryKinds();
  const composer = new ComposerContributions();
  const memory = new FeedMemory();
  const regions = new FeedRegions();
  const handle = new PromptHandle();
  const preferences: ChatPreferences = {
    verbose: { read: () => false, write: () => undefined },
    stretches: { read: () => 'all', write: () => undefined },
    disclosure: { read: () => ({}), write: () => undefined },
  };
</script>

{#snippet markdown(body: ChatMarkdownBody)}<Markdown {body} />{/snippet}
{#snippet code(body: ChatCodeBody)}
  <Code {body} />
{/snippet}
{#snippet button(control: ChatButton)}
  <button
    type={control.type}
    disabled={control.disabled}
    onclick={control.onclick}
    aria-label={control.label}
    class="h-8 rounded-md border border-border px-3 text-ui text-foreground"
  >
    {#if control.leading}{@render control.leading()}{/if}
    {#if control.icon}{@render control.icon()}{:else}{control.label}{/if}
  </button>
{/snippet}
{#snippet key(shown: ChatKey)}<kbd class="font-mono text-small">{shown.code}</kbd>{/snippet}

<ChatSurface
  turns={rig.turns}
  {kinds}
  {composer}
  {memory}
  {handle}
  {preferences}
  navigation={{ keyboard: true, files: false, link: () => () => undefined, linkMenu: () => undefined, entryAddress: () => null }}
  rendering={{
    regions,
    markdown,
    code,
    button,
    key,
    tip: () => () => undefined,
    copyText: async () => true,
    copyImage: async () => true,
    saveImage: async () => undefined,
    touch,
  }}
/>
