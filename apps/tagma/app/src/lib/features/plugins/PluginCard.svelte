<script lang="ts">
  import type { PluginComponent, PluginComponentKind, PluginRow } from '@tagma/server/plugins/contract/wire/rows';
  import type { SecretSet } from '@tagma/server/secrets/contract/wire/rows';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import type { WriteOutcome } from '$lib/features/settings/SettingsCatalog.svelte.js';
  import SecretFields from '$lib/features/secrets/SecretFields.svelte';
  import OptionField from '$lib/features/plugins/OptionField.svelte';

  let {
    row,
    projectId,
    values,
    secrets,
    secretsFailed,
    busy,
    writing,
    refusal,
    onenabled,
    onuninstall,
    onoption,
    onsecret,
  }: {
    row: PluginRow;
    projectId: number;
    values: Readonly<Record<string, string>>;
    secrets?: SecretSet;
    secretsFailed?: unknown;
    busy: boolean;
    writing: boolean;
    refusal?: Extract<WriteOutcome, { kind: 'refused' }>;
    onenabled: (enabled: boolean) => void;
    onuninstall: () => void;
    onoption: (key: string, value: string) => Promise<boolean>;
    onsecret: () => Promise<unknown>;
  } = $props();

  const FORMATS: Readonly<Record<string, string>> = { 'claude-code': 'Claude Code', 'agent-plugins': 'Agent Plugins' };
  const KINDS: Readonly<Record<PluginComponentKind, string>> = {
    skill: 'Skills',
    command: 'Commands',
    'mcp-server': 'MCP servers',
    agent: 'Agents',
    hook: 'Hooks',
  };

  const title = $derived(row.title ?? row.id);
  const format = $derived(row.format === null ? null : (FORMATS[row.format] ?? row.format));
  const taken = $derived(
    (Object.keys(KINDS) as PluginComponentKind[]).flatMap((kind) => {
      const items: readonly PluginComponent[] = row.components.filter((component) => component.kind === kind);
      return items.length === 0 ? [] : [{ kind, title: KINDS[kind], items }];
    }),
  );
  const plain = $derived(row.options.filter((option) => !option.sensitive));
  const sensitive = $derived(row.options.filter((option) => option.sensitive));
</script>

<section class="overflow-hidden rounded-lg border bg-raised" aria-label={title} data-plugin={row.id}>
  <div class="flex min-h-9 flex-wrap items-center gap-2 px-3 py-1">
    <h4 class="text-ui font-semibold">{title}</h4>
    {#if title !== row.id}<code class="stamp text-muted-foreground">{row.id}</code>{/if}
    {#if row.version !== null}<span class="text-ui text-muted-foreground tabular">{row.version}</span>{/if}
    {#if format !== null}
      <span class="eyebrow rounded-md bg-selected px-1.5 py-0.5 text-muted-foreground">{format}</span>
    {/if}
    <span class="flex-1"></span>
    <span class="text-small text-muted-foreground">Runs in this project</span>
    <SwitchControl
      label="Run {row.id} in this project"
      value={row.enabled}
      disabled={busy || (row.refused !== undefined && !row.enabled)}
      onwrite={onenabled}
    />
    <Button variant="outline" size="sm" disabled={busy} onclick={onuninstall}>Uninstall</Button>
  </div>

  <div class="grid gap-1.5 border-t border-border bg-sunken/40 px-3 py-2">
    {#if row.source.kind === 'folder'}
      <PathText path={row.source.path} class="stamp text-muted-foreground" />
    {:else}
      <FadeText text={row.source.url} class="stamp text-muted-foreground" />
    {/if}
    {#if row.description !== null && row.description !== ''}
      <p class="text-ui text-muted-foreground">{row.description}</p>
    {/if}
  </div>

  {#if row.refused !== undefined}
    <div class="border-t border-border px-3 py-3">
      <Callout tone="error" title="Tagma cannot read this plugin, so it gives the agent nothing" note={row.refused} />
    </div>
  {/if}

  {#if taken.length > 0}
    <div class="grid gap-3 border-t border-border px-3 py-3">
      <p class="text-small text-muted-foreground">Taken</p>
      {#each taken as group (group.kind)}
        <div class="grid gap-0.5">
          <p class="text-ui font-medium">{group.title}</p>
          {#each group.items as item, index (index)}
            <div class="flex min-w-0 items-baseline gap-2">
              <FadeText text={item.name} class="stamp max-w-full shrink-0" />
              {#if item.detail !== undefined}
                <FadeText text={item.detail} class="text-small text-muted-foreground" />
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  {#if row.ignored.length > 0}
    <div class="grid gap-1 border-t border-border px-3 py-3">
      <p class="text-small text-muted-foreground">Ignored</p>
      {#each row.ignored as item, index (index)}
        <div class="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span class="text-ui">{item.component}</span>
          {#if item.name !== null}<code class="stamp">{item.name}</code>{/if}
          <span class="text-small text-muted-foreground">{item.reason}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if row.options.length > 0}
    <div class="border-t border-border px-3 pt-3 pb-2">
      <p class="text-small text-muted-foreground">Options</p>
    </div>
    {#each plain as option (option.key)}
      <OptionField {option} value={values[option.key] ?? ''} busy={writing} onwrite={(value) => onoption(option.key, value)} />
    {/each}
    {#if secrets !== undefined}
      <SecretFields set={secrets} {projectId} onchanged={onsecret} />
    {:else if sensitive.length > 0 && row.enabled && secretsFailed !== undefined && secretsFailed !== null}
      <div class="border-t border-border px-3 py-3">
        <Callout
          tone="error"
          title="Its secret options could not be read"
          note={secretsFailed instanceof Error ? secretsFailed.message : String(secretsFailed)}
        />
      </div>
    {:else}
      {#each sensitive as option (option.key)}
        <div class="grid gap-1 border-t border-border bg-sunken px-3 py-3" data-option={option.key}>
          <div class="flex items-center gap-2">
            <span class="text-ui font-medium">{option.title}</span>
            <code class="stamp text-muted-foreground">{option.key}</code>
            <span class="text-ui text-muted-foreground">{option.set ? 'set' : option.required ? 'required, not set' : 'not set'}</span>
          </div>
          {#if !row.enabled}
            <p class="text-ui text-muted-foreground">A secret: its value is entered here once the plugin runs in this project.</p>
          {/if}
        </div>
      {/each}
    {/if}
    {#if refusal !== undefined}
      <div class="border-t border-border px-3 py-3">
        <Callout tone="error" title={refusal.told.text} note={refusal.reason} />
      </div>
    {/if}
  {/if}
</section>
