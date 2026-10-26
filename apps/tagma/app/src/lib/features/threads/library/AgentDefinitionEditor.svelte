<script lang="ts">
  import type {
    AgentCatalog,
    AgentDefinition,
    AgentFileScope,
    AgentFrontmatter,
    AgentPreview,
  } from '@tagma/server/threads/contract/wire/agentLibrary';
  import { onDestroy, untrack } from 'svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import * as Select from '$lib/shared/ui/select/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import AgentPrompt from './AgentPrompt.svelte';
  import { AgentLibraryRepo } from './AgentLibraryRepo.js';

  let {
    projectId,
    catalog,
    original,
    basedOn,
    onSaved,
    onCancel,
    onDirty,
    onBusy,
  }: {
    projectId: number;
    catalog: AgentCatalog;
    original?: AgentDefinition;
    basedOn?: AgentDefinition;
    onSaved: (definition: AgentDefinition) => void;
    onCancel: () => void;
    onDirty: (dirty: boolean) => void;
    onBusy: (busy: boolean) => void;
  } = $props();
  const repo = AgentLibraryRepo.use();
  const fieldId = $props.id();
  const initial = untrack(() => original);
  const base = untrack(() => basedOn);
  let name = $state(initial?.id ?? '');
  let scope = $state<AgentFileScope>((initial?.origin.scope ?? base?.origin.scope) === 'personal' ? 'personal' : 'project');
  let description = $state(base?.description ?? '');
  let extendsId = $state(base?.origin.scope === 'builtin' ? base.id : (base?.config.extends ?? ''));
  let body = $state(base && base.origin.scope !== 'builtin' ? base.body : '');
  let selected = $state<string[]>(
    untrack(() => [
      ...(base?.config.capabilities ??
        catalog.definitions.find((entry) => entry.id === base?.config.extends)?.config.capabilities ?? ['files', 'shell']),
    ]),
  );
  let sourceMode = $state(Boolean(initial));
  let rawSource = $state(initial?.source ?? '');
  let failure = $state<string | null>(null);
  let preview = $state<AgentPreview | null>(null);
  let previewedSource = $state('');
  let reading = $state(false);
  let saving = $state(false);
  let alive = true;
  onDestroy(() => {
    alive = false;
  });

  const builtins = $derived(catalog.definitions.filter((definition) => definition.origin.scope === 'builtin'));
  const available = $derived(
    extendsId
      ? (builtins.find((definition) => definition.id === extendsId)?.config.capabilities ?? [])
      : catalog.capabilities.map((capability) => capability.id),
  );
  const config = $derived<AgentFrontmatter>({
    ...base?.config,
    description,
    extends: extendsId || undefined,
    capabilities: selected.filter((id) => available.includes(id)),
  });
  const generated = $derived(`---\n${JSON.stringify(config, null, 2)}\n---\n${body}`);
  const source = $derived(sourceMode ? rawSource : generated);
  const dirty = $derived(initial ? source !== initial.source : Boolean(name || description || body || rawSource));
  const path = $derived(initial?.origin.path ?? `${scope === 'project' ? '.agents' : catalog.floors.personal}/${name || 'your-agent'}.md`);
  $effect(() => onDirty(dirty));
  $effect(() => onBusy(saving || reading));

  function toggle(id: string): void {
    selected = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
  }
  function editSource(): void {
    rawSource = generated;
    sourceMode = true;
  }
  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function readPreview(): Promise<void> {
    if (reading || saving) return;
    const submitted = source;
    reading = true;
    failure = null;
    try {
      const answer = await repo.preview.run(
        { projectId, definition: { id: name.trim() || 'new-agent', source: submitted } },
        { throwOnError: true },
      );
      if (alive && answer) {
        preview = answer;
        previewedSource = submitted;
      }
    } catch (error) {
      if (alive) failure = message(error);
    } finally {
      if (alive) reading = false;
    }
  }
  async function save(): Promise<void> {
    if (reading || saving) return;
    if (!name.trim()) {
      failure = 'Give the agent a name before saving.';
      return;
    }
    saving = true;
    failure = null;
    try {
      const answer = await repo.save.run(
        { projectId, definition: { name, scope, source, revision: initial?.origin.revision ?? null } },
        { throwOnError: true },
      );
      if (alive && answer) onSaved(answer);
    } catch (error) {
      if (alive) failure = message(error);
    } finally {
      if (alive) saving = false;
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex items-center justify-between gap-3 border-b px-6 py-4">
    <div>
      <h2 class="text-page font-semibold">
        {initial ? `Edit ${initial.name}` : base ? `Create based on ${base.name}` : 'Create an agent'}
      </h2>
      <p class="mt-1 text-small text-muted-foreground">
        {initial
          ? 'Edit the original Markdown file. Untouched fields stay in your source.'
          : 'Your instructions and capabilities. The system prompt is composed from them.'}
      </p>
    </div>
    <Button size="sm" variant="ghost" disabled={saving || reading} onclick={onCancel}>Back to library</Button>
  </div>
  <div class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(18rem,.9fr)_minmax(0,1.1fr)] lg:overflow-hidden">
    <form
      class="flex min-h-0 flex-col gap-5 p-6 lg:overflow-y-auto"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div class="grid grid-cols-2 items-start gap-4">
        <label class="grid content-start gap-2 text-small">
          Name
          <Input bind:value={name} disabled={Boolean(initial) || saving} placeholder="code-reviewer" spellcheck="false" />
        </label>
        {#if initial}
          <div class="grid content-start gap-2 text-small">
            <span class="text-muted-foreground">Stored in</span>
            <span class="flex h-7 items-center text-ui">{scope === 'project' ? 'Project' : 'Personal'} library</span>
          </div>
        {:else}
          <div class="grid content-start gap-2 text-small">
            <label for={`${fieldId}-scope`}>Save to</label>
            <Select.Root
              value={scope}
              disabled={saving}
              onValueChange={(value) => {
                if (value === 'project' || value === 'personal') scope = value;
              }}
            >
              <Select.Trigger id={`${fieldId}-scope`} class="w-full">
                {scope === 'project' ? 'Project' : 'Personal'}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="project" label="Project" />
                <Select.Item value="personal" label="Personal" />
              </Select.Content>
            </Select.Root>
          </div>
        {/if}
      </div>
      <p class="-mt-2 break-all font-mono text-meta text-muted-foreground">{path}</p>
      {#if sourceMode}
        <label class="grid min-h-0 flex-1 gap-2 text-small"
          >Markdown definition<textarea
            bind:value={rawSource}
            disabled={saving}
            spellcheck="false"
            class="min-h-80 w-full resize-y rounded-md border bg-sunken/30 p-3 font-mono text-small leading-6"
            aria-label="Complete Markdown definition"></textarea></label
        >
        <p class="text-small leading-5 text-muted-foreground">
          YAML frontmatter followed by the agent’s own instructions. The preview validates the same format used at birth.
        </p>
      {:else}
        <label class="grid gap-2 text-small"
          >Description<Input bind:value={description} disabled={saving} placeholder="What should someone choose this agent for?" /></label
        >
        <div class="grid content-start gap-2 text-small">
          <label for={`${fieldId}-base`}>Start from</label>
          <Select.Root bind:value={extendsId} disabled={saving}>
            <Select.Trigger id={`${fieldId}-base`} class="w-full">
              {builtins.find((definition) => definition.id === extendsId)?.name ?? 'A standalone agent'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="" label="A standalone agent" />
              {#each builtins as definition (definition.id)}
                <Select.Item value={definition.id} label={definition.name} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <label class="grid gap-2 text-small"
          >{extendsId ? 'Additional instructions' : 'Instructions'}<textarea
            bind:value={body}
            disabled={saving}
            spellcheck="false"
            class="min-h-44 w-full resize-y rounded-md border bg-sunken/30 p-3 font-mono text-small leading-6"
            placeholder="You are…"></textarea></label
        >
        <fieldset class="grid gap-3">
          <legend class="mb-3 text-small">Capabilities</legend>
          <div class="grid grid-cols-2 gap-2">
            {#each catalog.capabilities as capability (capability.id)}<Tooltip text={capability.description}
                ><label class="flex items-center gap-2 text-small"
                  ><input
                    type="checkbox"
                    checked={available.includes(capability.id) && selected.includes(capability.id)}
                    disabled={!available.includes(capability.id) || saving}
                    onchange={() => toggle(capability.id)}
                  />{capability.id}</label
                ></Tooltip
              >{/each}
          </div>
        </fieldset>
        <Button size="sm" variant="outline" class="self-start" disabled={saving} onclick={editSource}
          >Edit full source / model and permissions</Button
        >
      {/if}
      <p class="border-t pt-4 text-small leading-5 text-muted-foreground">
        Saving makes this definition available to you. Offering it to other agents is a separate policy. Existing threads adopt it through
        Refresh instructions on their next run.
      </p>
    </form>
    <section class="flex min-h-96 flex-col border-t bg-sunken/15 lg:min-h-0 lg:border-t-0 lg:border-l" aria-label="Draft prompt preview">
      <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 class="eyebrow text-muted-foreground">System prompt preview</h3>
          {#if preview && source !== previewedSource}<p class="mt-1 text-meta text-muted-foreground">
              Draft changed. Refresh the preview.
            </p>{/if}
        </div>
        <Button size="sm" variant="outline" disabled={saving || reading} onclick={() => void readPreview()}
          >{reading ? 'Reading…' : 'Preview'}</Button
        >
      </div>
      {#if preview}{#key preview}<AgentPrompt document={preview.prompt} />{/key}{:else}<div
          class="max-w-prose p-6 text-ui leading-7 text-muted-foreground"
        >
          Preview composes your definition with the base, its capabilities and kernel guidance. It does not create a thread, start a sandbox
          or connect a server.
        </div>{/if}
    </section>
  </div>
  <footer class="flex flex-wrap items-center justify-between gap-3 border-t bg-chrome px-6 py-4">
    <div class="min-w-0 flex-1">
      {#if failure}<p role="alert" class="text-small text-destructive">{failure}</p>
        <p class="mt-1 text-meta text-muted-foreground">Your draft is still here. Nothing was silently replaced.</p>{:else}<p
          class="text-small text-muted-foreground"
        >
          {initial
            ? 'Revision-checked replacement of the file you opened.'
            : 'Creates a new declaration; a name already in use is never overwritten.'}
        </p>{/if}
    </div>
    <Button variant="outline" disabled={saving || reading} onclick={onCancel}>Cancel</Button><Button
      disabled={saving || reading}
      onclick={() => void save()}>{saving ? 'Saving…' : initial ? 'Save definition' : 'Create agent'}</Button
    >
  </footer>
</div>
