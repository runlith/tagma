<script lang="ts">
  import type { AgentCatalog, AgentDefinition, AgentPreview } from '@tagma/server/threads/contract/wire/agentLibrary';
  import { useDialogHandle } from '@runlith/primitives/dialog-handle-context.svelte';
  import { byBest, rank } from '@runlith/search-text/match';
  import FadeText from '$lib/shared/FadeText.svelte';
  import MatchText from '$lib/shared/MatchText.svelte';
  import { onDestroy, untrack } from 'svelte';
  import Disclosure from '$lib/shared/ui/Disclosure.svelte';
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Lock from '@lucide/svelte/icons/lock';
  import FileText from '@lucide/svelte/icons/file-text';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import ViewTab from '$lib/shared/ui/ViewTab.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import type { AgentLibraryProps } from '../overlay.js';
  import { AgentLibraryRepo } from './AgentLibraryRepo.js';
  import AgentPrompt from './AgentPrompt.svelte';
  import AgentDefinitionEditor from './AgentDefinitionEditor.svelte';

  let { projectId, agentId, threadId, onSaved }: AgentLibraryProps = $props();
  const repo = AgentLibraryRepo.use();
  const dialog = useDialogHandle();
  let catalog = $state<AgentCatalog | null>(null);
  let reading = $state<AgentPreview | null>(null);
  let selected = $state('');
  let search = $state('');
  let loading = $state(false);
  let failure = $state<string | null>(null);
  let tab = $state<'prompt' | 'capabilities' | 'definition'>('prompt');
  let mode = $state<'read' | 'edit' | 'create'>('read');
  let original = $state<AgentDefinition | undefined>();
  let basedOn = $state<AgentDefinition | undefined>();
  let dirty = $state(false);
  let busy = $state(false);
  let discard = $state<(() => void) | null>(null);
  let revision = 0;
  let alive = true;
  const definition = $derived(reading?.definition);
  const found = $derived(
    rank(catalog?.definitions ?? [], search, (entry) => ({ name: entry.name, names: [entry.id], text: [entry.description] })),
  );
  const current = $derived(catalog?.definitions.find((entry) => entry.id === definition?.id));
  const scopes = [
    { id: 'builtin', label: 'Built-in' },
    { id: 'project', label: 'Project' },
    { id: 'personal', label: 'Personal' },
    { id: 'plugin', label: 'Plugins' },
  ] as const;
  const shownScopes = $derived(search.trim() === '' ? scopes : byBest(scopes, found, (scope, entry) => entry.origin.scope === scope.id));
  const tabs = [
    { id: 'prompt', label: 'System prompt' },
    { id: 'capabilities', label: 'Capabilities' },
    { id: 'definition', label: 'Definition' },
  ] as const;

  dialog.handle.apply({
    interactOutsideBehavior: () => (dirty || busy ? 'ignore' : 'close'),
    escapeKeydownBehavior: () => (dirty || busy ? 'ignore' : 'close'),
    onEscapeIgnored: () => {
      if (dirty) request(() => dialog.close());
    },
  });
  onDestroy(() => {
    alive = false;
    revision++;
  });
  $effect(() => {
    const project = projectId,
      id = agentId,
      thread = threadId;
    untrack(() => void load(project, id, thread));
  });

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  function request(action: () => void): void {
    if (busy) return;
    if (dirty) discard = action;
    else action();
  }
  function discardDraft(): void {
    const action = discard;
    discard = null;
    dirty = false;
    action?.();
  }
  function back(): void {
    request(() => {
      mode = 'read';
      dirty = false;
      busy = false;
    });
  }

  async function load(project: number, id?: string, thread?: string): Promise<void> {
    const read = ++revision;
    loading = true;
    failure = null;
    try {
      const answer = await repo.list.run(project, { throwOnError: true });
      if (!alive || read !== revision || !answer) return;
      catalog = answer;
      await inspect(id ?? answer.definitions[0]?.id ?? '', thread);
    } catch (error) {
      if (alive && read === revision) failure = errorText(error);
    } finally {
      if (alive && read === revision) loading = false;
    }
  }
  async function inspect(id: string, thread?: string): Promise<void> {
    const read = ++revision;
    selected = id;
    loading = true;
    failure = null;
    reading = null;
    mode = 'read';
    dirty = false;
    tab = 'prompt';
    try {
      const answer = thread
        ? await repo.thread.run({ projectId, threadId: thread }, { throwOnError: true })
        : await repo.preview.run({ projectId, definition: { id } }, { throwOnError: true });
      if (alive && read === revision && answer) {
        reading = answer;
        selected = answer.definition.id;
      }
    } catch (error) {
      if (alive && read === revision) failure = errorText(error);
    } finally {
      if (alive && read === revision) loading = false;
    }
  }
  function create(base?: AgentDefinition): void {
    request(() => {
      original = undefined;
      basedOn = base;
      mode = 'create';
      dirty = false;
      failure = null;
    });
  }
  function edit(): void {
    if (!definition?.editable) return;
    original = definition;
    basedOn = undefined;
    mode = 'edit';
    dirty = false;
  }
  async function saved(value: AgentDefinition): Promise<void> {
    dirty = false;
    busy = false;
    mode = 'read';
    search = '';
    onSaved?.();
    await load(projectId, value.id);
  }
  async function copySource(): Promise<void> {
    if (!definition) return;
    try {
      await navigator.clipboard.writeText(definition.source);
    } catch {
      failure = 'Clipboard access was denied. Select and copy the source text below.';
    }
  }
</script>

<section
  class="fixed left-1/2 top-1/2 flex h-[min(92dvh,64rem)] w-[min(96vw,90rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-float"
  aria-label="Agent library"
>
  <header class="flex shrink-0 items-center justify-between gap-4 border-b bg-chrome px-5 py-3">
    <Dialog.Header class="gap-0.5 text-left"
      ><Dialog.Title class="text-body">Agent library</Dialog.Title><Dialog.Description class="text-small"
        >Definitions and prompts · {reading?.context.project ?? 'current project'}</Dialog.Description
      ></Dialog.Header
    >
    <div class="flex items-center gap-1">
      <Button size="sm" variant="ghost" disabled={busy || loading} onclick={() => create()}><Plus class="size-3.5" />New agent</Button
      ><Button size="icon-sm" variant="ghost" disabled={busy} onclick={() => request(() => dialog.close())} aria-label="Close library"
        ><X class="size-4" /></Button
      >
    </div>
  </header>
  <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)]">
    <aside class="hidden min-h-0 flex-col border-r bg-chrome md:flex" aria-label="Agent definitions">
      <div class="p-4">
        <div class="flex items-center gap-1">
          <Input bind:value={search} aria-label="Find an agent" placeholder="Find an agent…" class="h-8 text-small" /><Tooltip
            text="Refresh library"
            ><Button
              size="icon-sm"
              variant="ghost"
              disabled={busy || loading}
              aria-label="Refresh library"
              onclick={() => request(() => void load(projectId, selected))}><RefreshCw class="size-3.5" /></Button
            ></Tooltip
          >
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-5">
        {#each shownScopes as scope (scope.id)}
          {@const entries = found.filter(({ item }) => item.origin.scope === scope.id)}
          {#if entries.length || !search}
            <div class="eyebrow flex items-center justify-between px-3 pb-2 pt-4 text-muted-foreground">
              <span>{scope.label}</span><span class="font-mono">{entries.length}</span>
            </div>
            {#each entries as { item: entry, hit } (entry.id)}
              <button
                disabled={busy}
                class={[
                  'mb-0.5 flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-hover',
                  selected === entry.id && mode === 'read' && !reading?.frozen && 'bg-selected',
                ]}
                onclick={() => request(() => void inspect(entry.id))}
              >
                {#if entry.origin.scope === 'builtin'}<Lock class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{:else}<FileText
                    class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  />{/if}
                <span class="min-w-0"
                  ><FadeText class="text-ui font-medium"><MatchText text={entry.name} positions={hit.positions} /></FadeText><span
                    class="mt-1 line-clamp-2 block text-meta leading-4 text-muted-foreground">{entry.description}</span
                  ></span
                >
              </button>
            {:else}<p class="px-3 py-2 text-small leading-5 text-muted-foreground">No {scope.label.toLowerCase()} definitions.</p>{/each}
          {/if}
        {/each}
      </div>
      {#if catalog?.rejected.length}<Disclosure class="border-t p-4 text-small text-muted-foreground">
          {#snippet summary()}{catalog?.rejected.length} unavailable definitions{/snippet}
          <div class="mt-3 grid max-h-44 gap-3 overflow-auto">
            {#each catalog.rejected as rejected (rejected.path)}<div>
                <p class="break-all font-mono text-meta">{rejected.path}</p>
                <p class="mt-1 text-destructive">{rejected.reason}</p>
              </div>{/each}
          </div>
        </Disclosure>{/if}
    </aside>
    <div class="flex min-h-0 min-w-0 flex-col">
      {#if mode !== 'read' && catalog}
        {#key `${mode}:${original?.id ?? basedOn?.id ?? ''}`}
          <AgentDefinitionEditor
            {projectId}
            {catalog}
            {original}
            {basedOn}
            onSaved={(value) => void saved(value)}
            onCancel={back}
            onDirty={(value) => (dirty = value)}
            onBusy={(value) => (busy = value)}
          />
        {/key}
      {:else}
        <div class="border-b p-3 md:hidden">
          <select
            aria-label="Select an agent"
            value={selected}
            class="h-7 w-full rounded-md border bg-background px-2 text-ui"
            onchange={(event) => void inspect(event.currentTarget.value)}
            >{#each catalog?.definitions ?? [] as entry (entry.id)}<option value={entry.id}>{entry.name} · {entry.origin.scope}</option
              >{/each}</select
          >
        </div>
        {#if loading}<p class="p-6 text-ui text-muted-foreground" role="status">Reading the definition…</p>{/if}
        {#if failure}<div class="flex flex-wrap items-center gap-3 border-b p-5">
            <p role="alert" class="min-w-0 flex-1 break-words text-ui text-destructive">{failure}</p>
            <Button size="sm" variant="outline" onclick={() => void load(projectId, selected)}>Refresh</Button>
          </div>{/if}
        {#if reading && definition}
          <div class="shrink-0 border-b px-5 pt-5 sm:px-8">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h1 class="text-title font-semibold">{definition.name}</h1>
                  <span class="rounded-sm border px-1.5 py-0.5 text-meta text-muted-foreground"
                    >{reading.frozen ? 'In this thread' : definition.origin.scope}</span
                  >
                </div>
                <p class="mt-2 max-w-prose text-small leading-5 text-muted-foreground">{definition.description}</p>
              </div>
              <div class="flex gap-2">
                {#if reading.frozen}{#if current}<Button size="sm" variant="outline" onclick={() => void inspect(current.id)}
                      >View current definition</Button
                    >{/if}{:else}{#if definition.editable}<Button size="sm" variant="outline" onclick={edit}>Edit definition</Button
                    >{/if}<Button size="sm" variant="ghost" onclick={() => create(definition)}>Create based on</Button>{/if}
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">
              <span class="break-all font-mono"
                >{definition.origin.path ?? (reading.frozen ? 'Saved by this thread' : 'Defined in code')}</span
              >
              {#if definition.config.extends}<span>Based on {definition.config.extends}</span>{/if}
              <span>Model default · {definition.config.model?.model ?? 'inherited at launch'}</span>
              {#if !reading.frozen}<span>Preview · Checkout</span>{/if}
            </div>
            {#if reading.frozen}<p class="mt-4 rounded-sm border bg-sunken/30 px-3 py-2 text-small leading-5 text-muted-foreground">
                {reading.notes[0]} Refresh instructions adopts the current definition for this thread’s next run.
              </p>{/if}
            <div class="mt-4 mb-2 flex gap-1" role="tablist" aria-label="Definition views">
              {#each tabs as entry (entry.id)}<ViewTab selected={tab === entry.id} onclick={() => (tab = entry.id)}>{entry.label}</ViewTab
                >{/each}
            </div>
          </div>
          {#if tab === 'prompt'}
            {#key reading}<AgentPrompt document={reading.prompt} frozen={reading.frozen} />{/key}
          {:else if tab === 'definition'}
            <div class="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
              <div class="mx-auto grid max-w-4xl gap-5">
                <div class="flex items-center justify-between gap-3">
                  <h2 class="text-page">
                    {reading.frozen
                      ? 'Definition held by this thread'
                      : definition.editable
                        ? 'The file is the definition'
                        : 'Built-in identity'}
                  </h2>
                  <Button size="sm" variant="outline" disabled={!definition.source} onclick={() => void copySource()}>Copy source</Button>
                </div>
                {#if definition.source}<pre
                    class="overflow-x-auto whitespace-pre-wrap break-words rounded-sm border bg-sunken/30 p-4 font-mono text-small leading-6">{definition.source}</pre>{:else}<p
                    class="text-body text-muted-foreground"
                  >
                    This thread retained no separate definition body. Its complete saved system prompt is available in the first tab.
                  </p>{/if}
                <Disclosure class="border-t pt-4" summaryClass="text-small">
                  {#snippet summary()}Declared parameters{/snippet}
                  <pre class="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-small leading-6">{JSON.stringify(
                      definition.config,
                      null,
                      2,
                    )}</pre>
                </Disclosure>
                <p class="text-small leading-6 text-muted-foreground">
                  {definition.origin.scope === 'builtin'
                    ? 'The built-in definition is owned by code. Create an extension instead of editing it here.'
                    : 'The source is a Markdown declaration, not a second record in an interface database.'} Saving a definition does not offer
                  it to other agents automatically.
                </p>
              </div>
            </div>
          {:else}
            <div class="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
              <div class="mx-auto max-w-4xl">
                <h2 class="text-page">Capabilities and their doors</h2>
                <p class="mt-2 text-small leading-6 text-muted-foreground">
                  {reading.frozen
                    ? 'The selection saved for this thread. Descriptors below come from today’s catalog, not a historical tool list.'
                    : 'Declared tools and guidance, not an authority grant.'} Live MCP schemas and loaded skill tools are determined at runtime.
                </p>
                {#each reading.capabilities as id (id)}
                  {@const capability = catalog?.capabilities.find((entry) => entry.id === id)}
                  <section class="grid gap-2 border-b py-5 sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <h3 class="font-mono text-small">{id}</h3>
                    <div>
                      <p class="text-small text-muted-foreground">
                        {capability?.description ?? 'No current capability descriptor is registered.'}
                      </p>
                      <div class="mt-3 flex flex-wrap gap-1.5">
                        {#each capability?.tools ?? [] as tool (tool.name)}<Disclosure
                            class="rounded-sm border px-2 py-1 text-meta"
                            summaryClass="font-mono"
                          >
                            {#snippet summary()}{tool.name}{/snippet}
                            <p class="max-w-prose py-2 text-small leading-6 text-muted-foreground">{tool.description}</p>
                          </Disclosure>{/each}
                      </div>
                      {#if capability?.runtimeSources.length}<p class="mt-3 text-meta text-muted-foreground">
                          Kernel sources · {capability.runtimeSources.join(', ')}
                        </p>{/if}
                    </div>
                  </section>
                {/each}
                {#if reading.capabilities.length === 0}<p class="py-5 text-ui text-muted-foreground">
                    {reading.frozen && definition.config.capabilities === undefined
                      ? 'No capability selection was retained in this thread’s profile.'
                      : 'No product capabilities selected.'}
                  </p>{/if}
                <div class="mt-5 grid gap-3 rounded-sm border bg-sunken/30 p-4 text-small leading-6 text-muted-foreground">
                  <p>
                    <strong class="text-foreground">Machine support stays separate.</strong> The operator question and retained-output retrieval
                    support the run itself and survive normal tool narrowing.
                  </p>
                  <p>
                    A capability does not guarantee permission. Removing web tools does not isolate a shell from the network; the thread’s
                    host owns that boundary.
                  </p>
                </div>
                {#each reading.notes as note}<p class="mt-4 text-small leading-6 text-muted-foreground">{note}</p>{/each}
              </div>
            </div>
          {/if}
        {:else if !loading && !failure}<p class="p-6 text-ui text-muted-foreground">Choose a definition to read its instructions.</p>{/if}
      {/if}
    </div>
  </div>
</section>

<Dialog.Root
  open={discard !== null}
  onOpenChange={(open) => {
    if (!open) discard = null;
  }}
>
  <Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>Discard this draft?</Dialog.Title><Dialog.Description
        >The definition has not been saved. Your existing file is unchanged.</Dialog.Description
      ></Dialog.Header
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (discard = null)}>Keep editing</Button><Button variant="confirm" onclick={discardDraft}
        >Discard draft</Button
      ></Dialog.Footer
    ></Dialog.Content
  >
</Dialog.Root>
