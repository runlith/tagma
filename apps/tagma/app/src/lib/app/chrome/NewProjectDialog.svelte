<script lang="ts">
  import Folder from '@lucide/svelte/icons/folder';
  import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import PointView from '@runlith/layer/svelte/PointView.svelte';
  import { STORAGE_MODES, type StorageMode } from '@tagma/server/projects/contract/wire/project';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import ViewTab from '$lib/shared/ui/ViewTab.svelte';
  import Told from '$lib/shared/Told.svelte';
  import { toldOf } from '$lib/wire/refusal.js';
  import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
  import {
    CreationFields,
    standsIn,
    type CreationDraft,
    type CreationField,
    type CreationFieldProps,
    type CreationPlace,
  } from './creation.js';
  import NewProjectCatalogs from './NewProjectCatalogs.svelte';
  import { folderName, ProjectCreation, refusedOf, type Refused } from './ProjectCreation.svelte.js';
  import { STORAGE } from './projectStorage.js';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const NEW = 'new';

  const creation = ProjectCreation.use();
  const projects = ProjectsRepo.use();
  const fields = CreationFields.use();

  let draftName = $state('');
  let draftPath = $state('');
  let typedPath = $state('');
  let draftStorage = $state<StorageMode>('stealth');
  let draftCatalogs = $state<readonly string[] | undefined>();
  let tab = $state(NEW);
  let contributed = $state.raw<Readonly<Record<string, unknown>>>({});
  let refused = $state.raw<Refused | null>(null);

  const reading = $derived(draftPath === '' ? undefined : projects.folder.key(draftPath));
  const folder = $derived(reading?.data);
  const unread = $derived(reading === undefined || reading.data !== undefined ? undefined : reading.error);
  const sources = $derived(fields.items.filter((field) => standsIn(field, 'source')));
  const chosenTab = $derived(sources.some((field) => field.id === tab) ? tab : NEW);
  const place = $derived<CreationPlace | undefined>(
    folder === undefined ? undefined : folder.carries ? 'carried' : chosenTab === NEW ? 'new' : 'source',
  );

  const here = (field: CreationField): boolean =>
    place === undefined ? false : place === 'source' ? field.id === chosenTab : standsIn(field, place);
  const drawn = (id: string): boolean => {
    const field = fields.find(id);
    return field !== undefined && here(field) && fields.drawn(field) === field;
  };

  const draft: CreationDraft = $derived({ name: draftName.trim(), rootPath: draftPath, storage: draftStorage });
  const underField = $derived(refused?.field !== undefined && drawn(refused.field) ? refused.field : undefined);
  const ready = $derived(
    !creation.creating &&
      draftName.trim() !== '' &&
      place !== undefined &&
      (place !== 'new' || draftCatalogs !== undefined) &&
      (place !== 'source' || contributed[chosenTab] !== undefined),
  );

  function put(id: string, value: unknown): void {
    if (value !== undefined) {
      if (contributed[id] !== value) contributed = { ...contributed, [id]: value };
    } else if (Object.hasOwn(contributed, id)) {
      contributed = Object.fromEntries(Object.entries(contributed).filter(([key]) => key !== id));
    }
  }

  function settle(path: string): void {
    const next = path.trim();
    if (next === draftPath) return;
    if (draftName.trim() === '' || draftName === folderName(draftPath)) draftName = next === '' ? '' : folderName(next);
    draftPath = next;
    refused = null;
  }

  $effect(() => {
    const offered = creation.offered;
    if (offered === null) return;
    draftName = offered.name;
    draftPath = offered.rootPath;
    typedPath = offered.rootPath;
    refused = offered.refused;
    creation.offered = null;
  });

  async function chooseFolder(): Promise<void> {
    const chosen = await creation.folders?.choose();
    if (chosen === undefined || chosen === null) return;
    settle(chosen);
  }

  async function createProject(): Promise<void> {
    const at = place;
    if (at === undefined || (at === 'new' && draftCatalogs === undefined)) return;
    refused = null;
    try {
      await creation.create({
        name: draft.name,
        rootPath: draft.rootPath,
        storage: at === 'new' ? draftStorage : undefined,
        catalogs: at === 'new' ? draftCatalogs : undefined,
        contributed: Object.fromEntries(Object.entries(contributed).filter(([id]) => drawn(id))),
      });
    } catch (error) {
      refused = refusedOf(error);
      return;
    }
    open = false;
    draftName = '';
    draftPath = '';
    typedPath = '';
    draftStorage = 'stealth';
    draftCatalogs = undefined;
    tab = NEW;
    contributed = {};
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-page">Add project</Dialog.Title>
      <Dialog.Description>The folder this project's graph is about.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-3">
      {#if creation.folders !== undefined}
        <div class="grid gap-1.5">
          <span class="eyebrow text-muted-foreground">Folder</span>
          <Button variant="outline" class="justify-start" onclick={() => void chooseFolder()} data-project-folder>
            <Folder class="size-4" />
            <FadeText text={draftPath === '' ? 'Choose a folder…' : folderName(draftPath)} />
          </Button>
        </div>
      {:else}
        <label class="grid gap-1.5">
          <span class="eyebrow text-muted-foreground">Root path</span>
          <Input
            placeholder="/absolute/path/to/repo"
            bind:value={typedPath}
            onchange={() => settle(typedPath)}
            class="font-mono text-small"
          />
        </label>
      {/if}
      {#if unread !== undefined && unread !== null}
        <div class="text-destructive" role="alert"><Told told={toldOf(unread)} /></div>
      {:else if draftPath !== '' && folder === undefined}
        <div class="flex items-center gap-2 text-muted-foreground"><Waiting />Reading the folder…</div>
      {/if}
      {#if folder !== undefined}
        {#if folder.carries}
          <div class="grid gap-1 rounded-lg border border-border bg-sunken px-3 py-2" data-carried-graph>
            <span class="flex items-center gap-2 font-medium">
              <FolderGit2 class="size-4 text-muted-foreground" />{folder.git
                ? 'This repository carries its graph'
                : 'This folder carries its graph'}
            </span>
            <span class="text-muted-foreground">
              {folder.git ? 'It lives in .tagma and travels with the repository.' : 'It lives in .tagma inside the folder.'} Tagma opens it as
              it stands.
            </span>
          </div>
        {:else if sources.length > 0}
          <div class="flex items-center gap-1" role="tablist" aria-label="Graph">
            <ViewTab selected={chosenTab === NEW} onclick={() => (tab = NEW)}>New graph</ViewTab>
            {#each sources as source (source.id)}
              <ViewTab selected={chosenTab === source.id} onclick={() => (tab = source.id)}>{source.source}</ViewTab>
            {/each}
          </div>
        {/if}
        <label class="grid gap-1.5">
          <span class="eyebrow text-muted-foreground">Name</span>
          <Input placeholder="runlith" bind:value={draftName} />
        </label>
        {#if place === 'new'}
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
          <NewProjectCatalogs bind:value={draftCatalogs} />
        {/if}
        <PointView
          point={fields}
          only={here}
          propsOf={(field: CreationField): CreationFieldProps => ({
            draft,
            value: contributed[field.id],
            put: (value: unknown) => put(field.id, value),
            refused: underField === field.id ? (refused?.told ?? null) : null,
            place: place ?? 'new',
          })}
        />
      {/if}
      {#if refused !== null && underField === undefined}
        <div class="text-destructive" role="alert"><Told told={refused.told} /></div>
      {/if}
    </div>
    <Dialog.Footer>
      <Button onclick={createProject} disabled={!ready}>Add project</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
