<script lang="ts">
  import Bot from '@lucide/svelte/icons/bot';
  import Check from '@lucide/svelte/icons/check';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { NATIVE_HARNESS, type SessionRef, sessionName } from '@tagma/server/platform/contract/wire/session';
  import AgentIcon from '$lib/shared/AgentIcon.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let {
    writer,
    project,
    label = true,
    class: className,
  }: {
    writer: SessionRef | null | undefined;
    project?: number;
    label?: boolean;
    class?: string;
  } = $props();

  const naming = SessionNaming.use();
  const names = ThreadNames.use();
  const addresses = Addresses.use();

  const native = $derived(writer != null && writer.harness === NATIVE_HARNESS);
  const words = $derived(writer != null && native ? names.of(writer.key, project === undefined ? undefined : String(project)) : null);
  const name = $derived(words?.label ?? (writer == null ? '' : sessionName(writer, naming.identity)));
  const href = $derived(
    writer == null || words == null || words.home === null ? null : addresses.thread(writer.key, words.home ?? undefined),
  );

  let copied = $state(false);
  let clearing: ReturnType<typeof setTimeout> | undefined;

  function copy(): void {
    if (writer == null) return;
    void navigator.clipboard.writeText(writer.key);
    copied = true;
    clearTimeout(clearing);
    clearing = setTimeout(() => (copied = false), 1200);
  }

  const FACE =
    'inline-flex min-w-0 max-w-48 shrink-0 items-center gap-1 align-middle text-small leading-none text-muted-foreground transition-colors';
</script>

{#snippet face(icon: 'agent' | 'bot' | 'copied')}
  {#if icon === 'agent'}
    <AgentIcon brand class="size-3.5 shrink-0" />
  {:else if icon === 'copied'}
    <Check class="size-3.5 shrink-0 text-status-done" />
  {:else}
    <Bot class="size-3.5 shrink-0" />
  {/if}
  {#if label}<FadeText class="label-lift" text={name} />{/if}
{/snippet}

{#if writer === undefined}
  <Tooltip text="A session this project’s registry has not read yet">
    <span class={cn(FACE, 'opacity-60', className)}><Bot class="size-3.5 shrink-0" /></span>
  </Tooltip>
{:else if writer !== null && native}
  <Tooltip text={href === null ? name : `${name} — open the thread`}>
    {#if href !== null}
      <a {href} class={cn(FACE, 'hover:text-foreground', className)} aria-label={label ? undefined : name}>{@render face('agent')}</a>
    {:else}
      <span class={cn(FACE, className)} role={label ? undefined : 'img'} aria-label={label ? undefined : name}>{@render face('agent')}</span
      >
    {/if}
  </Tooltip>
{:else if writer !== null}
  <Tooltip text={`${name} — click to copy the session id`}>
    <button type="button" onclick={copy} class={cn(FACE, 'hover:text-foreground', className)} aria-label={label ? undefined : name}>
      {@render face(copied ? 'copied' : 'bot')}
    </button>
  </Tooltip>
{/if}
