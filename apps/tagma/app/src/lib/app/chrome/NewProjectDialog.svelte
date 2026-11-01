<script lang="ts">
  import Folder from '@lucide/svelte/icons/folder';
  import PointView from '@runlith/layer/svelte/PointView.svelte';
  import { STORAGE_MODES, type StorageMode } from '@tagma/server/projects/contract/wire/project';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import Told from '$lib/shared/Told.svelte';
  import { Access, gateOf } from '$lib/wire/access.js';
  import { CreationFields, type CreationDraft, type CreationField, type CreationFieldProps } from './creation.js';
  import NewProjectCatalogs from './NewProjectCatalogs.svelte';
  import { folderName, ProjectCreation, refusedOf, type Refused } from './ProjectCreation.svelte.js';
  import { STORAGE } from './projectStorage.js';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const creation = ProjectCreation.use();
  const fields = CreationFields.use();
  const gate = gateOf(Access.find());
  const drawn = (id: string): boolean => {
    const field = fields.find(id);
    return field !== undefined && gate.allows(field.right);
  };

  let draftName = $state('');
  let draftPath = $state('');
  let draftStorage = $state<StorageMode>('stealth');
  let draftCatalogs = $state<readonly string[] | undefined>();
  let draftRemote = $state('');
  let contributed = $state.raw<Readonly<Record<string, unknown>>>({});
  let refused = $state.raw<Refused | null>(null);

  const draft: CreationDraft = $derived({ name: draftName.trim(), rootPath: draftPath.trim(), storage: draftStorage });
  const underField = $derived(refused?.field !== undefined && drawn(refused.field) ? refused.field : undefined);

  function put(id: string, value: unknown): void {
    if (value !== undefined) {
      if (contributed[id] !== value) contributed = { ...contributed, [id]: value };
    } else if (Object.hasOwn(contributed, id)) {
      contributed = Object.fromEntries(Object.entries(contributed).filter(([key]) => key !== id));
    }
  }

  $effect(() => {
    const offered = creation.offered;
    if (offered === null) return;
    draftName = offered.name;
    draftPath = offered.rootPath;
    refused = offered.refused;
    creation.offered = null;
  });

  async function chooseFolder(): Promise<void> {
    const chosen = await creation.folders?.choose();
    if (chosen === undefined || chosen === null) return;
    if (draftName.trim() === '' || draftName === folderName(draftPath)) draftName = folderName(chosen);
    draftPath = chosen;
  }

  async function createProject(): Promise<void> {
    const catalogs = draftCatalogs;
    if (catalogs === undefined) return;
    refused = null;
    const graphRemote = draftStorage === 'stealth' && draftRemote.trim() !== '' ? draftRemote.trim() : undefined;
    try {
      await creation.create({
        ...draft,
        catalogs,
        graphRemote,
        contributed: Object.fromEntries(Object.entries(contributed).filter(([id]) => drawn(id))),
      });
    } catch (error) {
      refused = refusedOf(error);
      return;
    }
    open = false;
    draftName = '';
    draftPath = '';
    draftStorage = 'stealth';
    draftCatalogs = undefined;
    draftRemote = '';
    contributed = {};
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-page">New project</Dialog.Title>
      <Dialog.Description>The folder this project's graph is about.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-3">
      {#if creation.folders !== undefined}
        <div class="grid gap-1.5">
          <span class="eyebrow text-muted-foreground">Folder</span>
          <Button variant="outline" class="justify-start" onclick={() => void chooseFolder()} data-project-folder>
            <Folder class="size-4" />
            <span class="truncate">{draftPath === '' ? 'Choose a folder…' : folderName(draftPath)}</span>
          </Button>
        </div>
      {/if}
      <label class="grid gap-1.5">
        <span class="eyebrow text-muted-foreground">Name</span>
        <Input placeholder="runlith" bind:value={draftName} />
      </label>
      {#if creation.folders === undefined}
        <label class="grid gap-1.5">
          <span class="eyebrow text-muted-foreground">Root path</span>
          <Input placeholder="/absolute/path/to/repo" bind:value={draftPath} class="font-mono text-small" />
        </label>
      {/if}
      <div class="grid gap-1.5" role="radiogroup" aria-label="Storage">
        <span class="eyebrow text-muted-foreground">Storage</span>
        {#each STORAGE_MODES as mode (mode)}
          <label class="flex cursor-pointer items-baseline gap-2 text-ui">
            <input type="radio" name="storage" value={mode} bind:group={draftStorage} />
            <span>
              <span class="font-medium">{STORAGE[mode].label}</span>
              <span class="text-muted-foreground"> — {STORAGE[mode].note}</span>
            </span>
          </label>
        {/each}
      </div>
      {#if draftStorage === 'stealth'}
        <label class="grid gap-1.5">
          <span class="eyebrow text-muted-foreground">Graph remote</span>
          <Input placeholder="git@github.com:you/graph.git" bind:value={draftRemote} class="font-mono text-small" />
          <span class="text-small text-muted-foreground">
            Optional. A private git repository Tagma keeps the graph in: a graph it holds comes back here, an empty one receives this graph.
          </span>
        </label>
      {/if}
      <NewProjectCatalogs bind:value={draftCatalogs} />
      <PointView
        point={fields}
        gate={gate.shown}
        propsOf={(field: CreationField): CreationFieldProps => ({
          draft,
          value: contributed[field.id],
          put: (value: unknown) => put(field.id, value),
          refused: underField === field.id ? (refused?.told ?? null) : null,
        })}
      />
      {#if refused !== null && underField === undefined}
        <div class="text-destructive" role="alert"><Told told={refused.told} /></div>
      {/if}
    </div>
    <Dialog.Footer>
      <Button onclick={createProject} disabled={creation.creating || !draftName.trim() || !draftPath.trim() || draftCatalogs === undefined}
        >Create project</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
