<script lang="ts">
  import type { PluginComponent, PluginPreview, PluginRow } from '@tagma/server/plugins/contract/wire/rows';
  import Bot from '@lucide/svelte/icons/bot';
  import Globe from '@lucide/svelte/icons/globe';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import MonitorCheck from '@lucide/svelte/icons/monitor-check';
  import Plug from '@lucide/svelte/icons/plug';
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import SquareSlash from '@lucide/svelte/icons/square-slash';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Zap from '@lucide/svelte/icons/zap';
  import AudioLines from '@lucide/svelte/icons/audio-lines';
  import Cpu from '@lucide/svelte/icons/cpu';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import type { Component } from 'svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { type ComponentSaid, type ProvidersSaid, providersSaid, saidOf } from '$lib/features/plugins/words.js';

  let {
    components,
    providers,
    ignored,
    consent,
    options,
  }: {
    components: readonly PluginComponent[];
    providers?: PluginRow['providers'];
    ignored: PluginRow['ignored'];
    consent?: PluginPreview['consent'];
    options: PluginRow['options'];
  } = $props();

  const BROUGHT: Readonly<Record<ProvidersSaid['kind'], Component<{ class?: string }>>> = {
    models: Cpu,
    harnesses: SquareTerminal,
    speech: AudioLines,
  };

  const brought = $derived(providersSaid(providers));

  const ICONS: Readonly<Record<ComponentSaid['kind'], Component<{ class?: string }>>> = {
    'mcp-server': Plug,
    program: Terminal,
    skill: Sparkles,
    command: SquareSlash,
    agent: Bot,
    hook: Zap,
    process: Terminal,
    contribution: Puzzle,
    provider: Cpu,
  };

  const said = $derived(components.map(saidOf));
  const costs = $derived(
    consent === undefined
      ? []
      : [
          ...consent.reaches.map((text) => ({
            icon: Globe,
            title: `Reaches ${URL.canParse(text) ? new URL(text).host : text}`,
            detail: text,
          })),
          ...(consent.runs.length === 0
            ? [{ icon: MonitorCheck, title: 'Runs nothing on this computer', detail: null }]
            : consent.runs.map((text) => ({ icon: Terminal, title: 'Runs on this computer', detail: text }))),
          ...consent.raises.map((text) => ({ icon: KeyRound, title: text, detail: null })),
          ...(consent.reaches.length === 0
            ? []
            : [{ icon: KeyRound, title: 'Each service asks you to sign in once it is added', detail: 'Agents never sign in for you.' }]),
        ],
  );
  const asked = $derived(options.filter((option) => option.required));
</script>

{#snippet line(Icon: Component<{ class?: string }>, title: string, detail: string | null)}
  <div class="grid grid-cols-[auto_1fr] items-start gap-3 px-3 py-2">
    <Icon class="mt-0.5 size-4 text-muted-foreground" />
    <span class="grid min-w-0 gap-0.5">
      <FadeText text={title} class="text-ui font-medium" />
      {#if detail !== null && detail !== ''}<FadeText text={detail} class="stamp text-muted-foreground" />{/if}
    </span>
  </div>
{/snippet}

{#if brought.length > 0 || said.length > 0}
  <section class="grid gap-2" aria-label="What agents get">
    <h3 class="text-small font-medium text-muted-foreground">What agents get</h3>
    <div class="grid divide-y rounded-lg border bg-raised">
      {#each brought as one (one.kind)}{@render line(BROUGHT[one.kind], one.title, one.detail)}{/each}
      {#each said as one, index (index)}{@render line(ICONS[one.kind], one.title, one.detail)}{/each}
    </div>
  </section>
{/if}

{#if costs.length > 0}
  <section class="grid gap-2" aria-label="Before you add it">
    <h3 class="text-small font-medium text-muted-foreground">Before you add it</h3>
    <div class="grid divide-y rounded-lg border bg-raised">
      {#each costs as one, index (index)}{@render line(one.icon, one.title, one.detail)}{/each}
    </div>
  </section>
{/if}

{#if asked.length > 0}
  <section class="grid gap-2" aria-label="It asks for">
    <h3 class="text-small font-medium text-muted-foreground">It asks for</h3>
    <div class="grid divide-y rounded-lg border bg-raised">
      {#each asked as option (option.key)}{@render line(KeyRound, option.title, option.description)}{/each}
    </div>
  </section>
{/if}

{#if ignored.length > 0}
  <section class="grid gap-2" aria-label="Not taken">
    <h3 class="text-small font-medium text-muted-foreground">Tagma does not take</h3>
    <div class="grid gap-1">
      {#each ignored as item, index (index)}
        <p class="text-small text-muted-foreground">
          <span class="text-foreground">{item.component}{item.name === null ? '' : ` ${item.name}`}</span>
          {item.reason}
        </p>
      {/each}
    </div>
  </section>
{/if}
