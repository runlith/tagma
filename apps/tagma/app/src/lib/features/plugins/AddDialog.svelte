<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import Package from '@lucide/svelte/icons/package';
  import Plug from '@lucide/svelte/icons/plug';
  import Store from '@lucide/svelte/icons/store';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { Refusal, toldOf } from '$lib/wire/refusal.js';
  import type { Told } from '$lib/wire/told.js';
  import McpDeclarationForm from '$lib/features/mcp/DeclarationForm.svelte';
  import { McpRepo, type McpDeclarationInput } from '$lib/features/mcp/Repo.js';
  import { addressOf } from '$lib/features/plugins/address.js';
  import { idOf, type Place } from '$lib/features/plugins/place.js';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';

  let {
    open = $bindable(false),
    project,
    ondone,
  }: {
    open?: boolean;
    project: Project;
    ondone: (at: string | null) => Promise<unknown>;
  } = $props();

  const plugins = PluginsRepo.use();
  const mcp = McpRepo.use();

  let typed = $state('');
  let busy = $state(false);
  let failed = $state<Told | undefined>(undefined);
  let refusal = $state<{ code: string; reason: string; unblock: readonly string[] } | undefined>(undefined);

  const address = $derived(addressOf(typed));

  $effect(() => {
    if (open) return;
    typed = '';
    failed = undefined;
    refusal = undefined;
  });

  async function act(work: () => Promise<Place | null>): Promise<void> {
    busy = true;
    failed = undefined;
    try {
      const at = await work();
      open = false;
      await ondone(at === null ? null : idOf(at));
    } catch (error: unknown) {
      failed = toldOf(error);
      refusal = error instanceof Refusal ? { code: error.code, reason: error.reason, unblock: error.unblock } : undefined;
    } finally {
      busy = false;
    }
  }

  const addSource = (source: string) =>
    act(async () => {
      const marketplace = await plugins.addMarketplace.run({ source }, { throwOnError: true });
      return marketplace === undefined ? null : { kind: 'source', id: marketplace.id };
    });
  const installPlugin = (source: string) =>
    act(async () => {
      const plugin = await plugins.install.run({ projectId: project.id, source, scope: 'project' }, { throwOnError: true });
      return plugin === undefined ? null : { kind: 'plugin', id: plugin.id };
    });
  const declare = (declaration: McpDeclarationInput) =>
    act(async () => {
      await mcp.add.run({ projectId: project.id, scope: 'project', declaration }, { throwOnError: true });
      return { kind: 'server', scope: 'project', name: declaration.name };
    });
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title class="text-page">Add by address</Dialog.Title>
      <Dialog.Description>A source of plugins, one plugin, a service's address or a program to run.</Dialog.Description>
    </Dialog.Header>
    <Input class="font-mono" placeholder="owner/repo, a git URL, a folder, https://…/mcp or npx …" bind:value={typed} disabled={busy} />

    {#if address.kind === 'empty'}
      <div class="grid grid-cols-2 gap-2 text-small text-muted-foreground">
        <span class="flex items-center gap-2"
          ><Store class="size-3.5" />A source: <code class="stamp text-foreground">owner/repo</code></span
        >
        <span class="flex items-center gap-2"><Package class="size-3.5" />A plugin: a git URL or a folder</span>
        <span class="flex items-center gap-2"
          ><Plug class="size-3.5" />A service: <code class="stamp text-foreground">https://…/mcp</code></span
        >
        <span class="flex items-center gap-2"
          ><Terminal class="size-3.5" />A program: <code class="stamp text-foreground">npx some-mcp</code></span
        >
      </div>
    {:else if address.kind === 'source'}
      <div class="grid gap-2">
        <p class="text-ui">
          A repository or folder: add it as a source of plugins, or install the one plugin it holds into {project.name}.
        </p>
        <div class="flex gap-2">
          <Button disabled={busy} onclick={() => void addSource(address.source)}><Store class="size-3.5" />Add as a source</Button>
          <Button variant="outline" disabled={busy} onclick={() => void installPlugin(address.source)}>
            <Package class="size-3.5" />Install as a plugin
          </Button>
        </div>
      </div>
    {:else}
      {#key typed}
        <div class="overflow-hidden rounded-lg border">
          <p class="bg-sunken px-3 pt-3 text-small text-muted-foreground">
            {address.kind === 'service' ? 'A service agents reach over the network' : 'A program agents run on this computer'}, for {project.name}.
          </p>
          <McpDeclarationForm
            start={address.start}
            {busy}
            {refusal}
            onsubmit={(declaration) => void declare(declaration)}
            oncancel={() => (open = false)}
          />
        </div>
      {/key}
    {/if}

    {#if failed !== undefined && address.kind === 'source'}<Callout tone="error" title={failed.text} note={failed.note} />{/if}
  </Dialog.Content>
</Dialog.Root>
