<script lang="ts">
  import type { HoverIntent } from '@runlith/primitives/popover.svelte';
  import { Router } from '@runlith/layer/Router';
  import { sessionName } from '@tagma/server/platform/contract/wire/session';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
  import SettingControl from '../SettingControl.svelte';
  import SwitchControl from '../controls/SwitchControl.svelte';
  import { settingText } from '../controls/units.js';
  import { settingAnswer, type WriteOutcome } from '../SettingsCatalog.svelte.js';
  import { type SettingChips, writeScope } from './SettingChips.svelte.js';

  let { id, chips }: { id: string; chips: SettingChips } = $props();

  const HOVER: HoverIntent = { openMs: 300, closeMs: 300 };
  const UNEDITABLE = new Set(['managed', 'rows', 'colors', 'machine']);

  const router = Router.use();
  const naming = SessionNaming.use();
  const workspace = Workspace.use();
  const home = $derived(workspace.find(chips.projectId));

  const entry = $derived(chips.entry(id));
  const scope = $derived(entry === undefined ? 'user' : writeScope(entry));
  const answer = $derived(entry === undefined ? undefined : settingAnswer(entry, scope));
  const editable = $derived(
    entry !== undefined &&
      (entry.control?.kind === 'ask' ||
        (!UNEDITABLE.has(entry.control?.kind ?? '') && (typeof entry.value !== 'object' || entry.value === null))),
  );
  const origin = $derived.by(() => {
    if (entry === undefined) return '';
    if (entry.from === 'default') return 'Tagma default';
    const layer = entry.from === 'user' ? 'Every project' : home === null ? 'This project' : labelOf(home);
    const writer = entry.layers[entry.from]?.writer;
    return writer === undefined ? layer : `${layer}, set by ${sessionName(writer, naming.identity)}`;
  });

  let open = $state(false);
  let chip = $state<HTMLElement | null>(null);
  let busy = $state(false);
  let failure = $state<Extract<WriteOutcome, { kind: 'refused' }> | null>(null);

  async function write(value: unknown): Promise<void> {
    if (busy) return;
    busy = true;
    failure = null;
    const outcome = await chips.write(id, scope, value);
    busy = false;
    if (outcome.kind !== 'refused') return;
    failure = outcome;
    open = true;
  }
</script>

{#if entry === undefined || answer === undefined}
  <code>{id}</code>
{:else}
  <span class="setting-chip" data-setting={id} data-state={open ? 'open' : 'closed'} bind:this={chip}>
    <Popover.Root
      bind:open
      onOpenChange={(next) => {
        if (next) chips.refresh();
      }}
    >
      <Popover.Trigger hover={HOVER} class="setting-key" aria-label={`${entry.title} setting`}>{id}</Popover.Trigger>
      <Popover.Content anchor={chip ?? undefined} side="bottom" align="start" collisionPadding={12} trapFocus={false} class="w-80 gap-3">
        <div class="grid gap-1">
          <span class="text-ui font-medium">{entry.title}</span>
          <code class="stamp text-meta text-muted-foreground">{entry.id}</code>
          <p class="text-small text-muted-foreground">{entry.description}</p>
        </div>
        <div class="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span class="min-w-0 text-small text-muted-foreground">{origin}</span>
          {#if editable}
            <SettingControl
              {entry}
              {answer}
              layerName={scope === 'user' ? 'every project' : home === null ? 'this project' : labelOf(home)}
              disabled={busy}
              onwrite={(value) => void write(value)}
              ondecline={() => undefined}
            />
          {:else}
            <span class="text-small">{settingText(entry, entry.value)}</span>
          {/if}
        </div>
        {#if failure !== null}
          <div class="grid gap-0.5 text-small" role="alert">
            <p class="text-destructive"><span class="stamp">{failure.code}</span> — {failure.reason}</p>
            {#if failure.unblock[0]}
              <p class="text-muted-foreground">{failure.unblock[0]}</p>
            {/if}
          </div>
        {/if}
        <a
          class="text-small text-muted-foreground hover:text-foreground"
          href={settingsHref(router, entry.section, scope, entry.id, home?.name)}
        >
          Open in Settings
        </a>
      </Popover.Content>
    </Popover.Root>
    {#if typeof entry.value === 'boolean'}
      <SwitchControl label={entry.title} value={entry.value} disabled={busy} small onwrite={(value) => void write(value)} />
    {:else}
      <span class="text-muted-foreground">{settingText(entry, entry.value)}</span>
    {/if}
  </span>
{/if}
