<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
  import { MCP_SERVER_LINK } from '@tagma/server/mcp/contract/wire/link';
  import { PLUGIN_LINK } from '@tagma/server/plugins/contract/wire/link';
  import Package from '@lucide/svelte/icons/package';
  import Plug from '@lucide/svelte/icons/plug';
  import Store from '@lucide/svelte/icons/store';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Refusal, toldOf } from '$lib/wire/refusal.js';
  import type { Told } from '$lib/wire/told.js';
  import type { Link } from '$lib/features/opening/Link.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import McpDeclarationForm from '$lib/features/mcp/DeclarationForm.svelte';
  import { McpRepo, type McpDeclarationInput } from '$lib/features/mcp/Repo.js';
  import { addressOf } from '$lib/features/plugins/address.js';
  import Gives from '$lib/features/plugins/Gives.svelte';
  import { idOf, type Place } from '$lib/features/plugins/place.js';
  import { type Found, PluginsRepo } from '$lib/features/plugins/Repo.js';
  import Tile from '$lib/features/plugins/Tile.svelte';

  let {
    project,
    scope,
    ondone,
    oncancel,
  }: {
    project: Project;
    scope: SettableScope;
    ondone: (at: string | null) => Promise<unknown>;
    oncancel: () => void;
  } = $props();

  type Added = { readonly at: Place; readonly said: string; readonly link: Link | null };

  const plugins = PluginsRepo.use();
  const mcp = McpRepo.use();
  const opening = Opening.use();

  let typed = $state('');
  let busy = $state(false);
  let failed = $state<Told | undefined>(undefined);
  let refusal = $state<{ code: string; reason: string; unblock: readonly string[] } | undefined>(undefined);
  let found = $state<{ readonly at: string; readonly what: Found } | undefined>(undefined);
  let added = $state<Added | null>(null);

  const address = $derived(addressOf(typed));
  const reach = $derived(scope === 'user' ? 'all your projects' : project.name);

  async function act(work: () => Promise<Added | null>): Promise<void> {
    busy = true;
    failed = undefined;
    added = null;
    try {
      const done = await work();
      typed = '';
      found = undefined;
      refusal = undefined;
      added = done;
      await ondone(done === null ? null : idOf(done.at));
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
      return marketplace === undefined
        ? null
        : {
            at: { kind: 'source', id: marketplace.id },
            said: `Added the source ${marketplace.title}; its plugins are in the Plugins catalog.`,
            link: null,
          };
    });
  const installPrepared = (prepared: string) =>
    act(async () => {
      const plugin = await plugins.installPrepared.run({ projectId: project.id, prepared, scope }, { throwOnError: true });
      return plugin === undefined
        ? null
        : {
            at: { kind: 'plugin', id: plugin.id },
            said: `Added ${plugin.title ?? plugin.id} to ${reach}.`,
            link: { kind: PLUGIN_LINK, target: { projectId: project.id, id: plugin.id } },
          };
    });

  async function inspect(source: string): Promise<void> {
    busy = true;
    failed = undefined;
    try {
      const what = await plugins.inspect.run({ projectId: project.id, source }, { throwOnError: true });
      found = what === undefined ? undefined : { at: source, what };
    } catch (error: unknown) {
      failed = toldOf(error);
    } finally {
      busy = false;
    }
  }
  const declare = (declaration: McpDeclarationInput) =>
    act(async () => {
      await mcp.add.run({ projectId: project.id, scope, declaration }, { throwOnError: true });
      return {
        at: { kind: 'server', scope, name: declaration.name },
        said: `Added the server ${declaration.name} to ${reach}.`,
        link: { kind: MCP_SERVER_LINK, target: { projectId: project.id, scope, name: declaration.name, contributor: null } },
      };
    });
</script>

<div class="grid gap-4">
  <Input
    class="font-mono"
    placeholder="owner/repo, a git URL, a folder, npm:name, https://…/mcp or npx …"
    aria-label="Address"
    bind:value={typed}
    disabled={busy}
    autocomplete="off"
    spellcheck={false}
  />

  {#if address.kind === 'empty'}
    <div class="grid grid-cols-2 gap-2 text-small text-muted-foreground">
      <span class="flex items-center gap-2"><Store class="size-3.5" />A source: <code class="stamp text-foreground">owner/repo</code></span>
      <span class="flex items-center gap-2"
        ><Package class="size-3.5" />A plugin: a git URL, a folder or <code class="stamp text-foreground">npm:name</code></span
      >
      <span class="flex items-center gap-2"
        ><Plug class="size-3.5" />A service: <code class="stamp text-foreground">https://…/mcp</code></span
      >
      <span class="flex items-center gap-2"
        ><Terminal class="size-3.5" />A program: <code class="stamp text-foreground">npx some-mcp</code></span
      >
    </div>
  {:else if address.kind === 'source'}
    {@const shown = found !== undefined && found.at === address.source ? found.what : undefined}
    {#if shown === undefined}
      <div class="flex items-center gap-3">
        <p class="flex-1 text-ui text-muted-foreground">
          A repository, a folder or a package. Tagma reads it first and says what it holds.
        </p>
        <Button disabled={busy} onclick={() => void inspect(address.source)}>
          {#if busy}<Waiting class="size-3" />{/if}Read it
        </Button>
      </div>
    {:else if shown.kind === 'marketplace'}
      <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border bg-raised p-3">
        <Store class="size-4 text-muted-foreground" />
        <span class="grid min-w-0 gap-0.5">
          <FadeText text="A source of plugins: {shown.title ?? shown.name}" class="text-ui font-medium" />
          <span class="text-small text-muted-foreground tabular"
            >{shown.entries} {shown.entries === 1 ? 'plugin' : 'plugins'}. Unreviewed: Tagma has not read them.</span
          >
        </span>
        <Button disabled={busy} onclick={() => void addSource(address.source)}>Add source</Button>
      </div>
    {:else}
      <div class="grid max-h-96 gap-4 overflow-y-auto">
        <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <Tile title={shown.preview.title ?? shown.preview.id} />
          <span class="grid min-w-0 gap-0.5">
            <FadeText text={shown.preview.title ?? shown.preview.id} class="text-ui font-medium" />
            <FadeText text={shown.preview.description ?? 'One plugin'} class="text-small text-muted-foreground" />
          </span>
          <Button disabled={busy} onclick={() => void installPrepared(shown.preview.prepared)}
            >Add to {shown.preview.providers !== undefined && shown.preview.components.length === 0 ? 'all your projects' : reach}</Button
          >
        </div>
        <Gives
          components={shown.preview.components}
          providers={shown.preview.providers}
          ignored={shown.preview.ignored}
          consent={shown.preview.consent}
          options={shown.preview.options}
        />
      </div>
    {/if}
  {:else}
    {#key typed}
      <div class="overflow-hidden rounded-lg border">
        <p class="bg-sunken px-3 pt-3 text-small text-muted-foreground">
          {address.kind === 'service' ? 'A service agents reach over the network' : 'A program agents run on this computer'}, for {reach}.
        </p>
        <McpDeclarationForm start={address.start} {busy} {refusal} onsubmit={(declaration) => void declare(declaration)} {oncancel} />
      </div>
    {/key}
  {/if}

  {#if failed !== undefined && address.kind === 'source'}<Callout tone="error" title={failed.text} note={failed.note} />{/if}
  {#if added !== null && address.kind === 'empty'}
    {@const link = added.link}
    <div class="flex items-center gap-3">
      <p class="flex-1 text-ui text-muted-foreground">{added.said}</p>
      {#if link !== null}
        <Button size="sm" variant="outline" onclick={() => void opening.open(link, 'full')}>Open it</Button>
      {/if}
    </div>
  {/if}
</div>
