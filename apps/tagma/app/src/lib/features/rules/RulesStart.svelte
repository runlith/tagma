<script lang="ts">
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { Router } from '@runlith/layer/Router';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Asking } from '$lib/features/threads/Asking.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { useHere } from './here.js';
  import { ASK_RULES, askStarter, STARTERS } from './words.js';

  const asking = Asking.use();
  const blocks = BlocksRepo.use();
  const tree = ProjectTree.use();
  const tags = TagCatalog.use();
  const notices = Notices.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const here = useHere();

  const projectId = $derived(here.ask()?.projectId ?? null);
  const tag = $derived(tags.lawTag);

  function ask(text: string): void {
    const place = here.ask();
    if (place !== null) void asking.draft(place, text);
  }

  async function write(): Promise<void> {
    const root = tree.rootName;
    if (tag === null || root === null) return;
    try {
      const block = await blocks.create.run({ parentId: root, title: 'New rule', tags: [tag] }, { throwOnError: true });
      if (block !== undefined) void router.goto(addresses.block(block.identity));
    } catch (error) {
      notices.refusal(error);
    }
  }
</script>

<div class="mx-auto mt-16 max-w-lg px-2">
  <h1 class="text-title font-semibold text-foreground">Rules your agents can't skip</h1>
  <p class="mt-2 text-body leading-relaxed text-muted-foreground">
    Say how this project should be built — which part may not import which, how large a file may grow. Tagma tells every agent the rule and
    checks each commit against it.
  </p>

  <div class="mt-6 grid gap-2">
    <div class="flex items-center gap-3 rounded-lg border border-brand/40 bg-raised px-4 py-3">
      <span class="grid size-8 shrink-0 place-items-center rounded-md bg-selected text-brand"><Sparkles class="size-4" /></span>
      <div class="min-w-0 flex-1">
        <p class="text-body font-medium text-foreground">Ask Tagma</p>
        <p class="text-ui text-muted-foreground">An agent reads the project and proposes rules for its real boundaries.</p>
      </div>
      <Button size="sm" disabled={projectId === null} onclick={() => ask(ASK_RULES)}>Start</Button>
    </div>
    {#if tag !== null}
      <div class="flex items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-md bg-selected text-muted-foreground"
          ><PencilLine class="size-4" /></span
        >
        <div class="min-w-0 flex-1">
          <p class="text-body font-medium text-foreground">Write one yourself</p>
          <p class="text-ui text-muted-foreground">A rule in your words. Make it a check later.</p>
        </div>
        <Button size="sm" variant="outline" disabled={blocks.create.pending || tree.rootName === null} onclick={() => void write()}
          >Write</Button
        >
      </div>
    {/if}
  </div>

  <p class="mt-6 text-ui text-muted-foreground">Rules people start with</p>
  <div class="mt-2 flex flex-wrap gap-2">
    {#each STARTERS as norm (norm)}
      <button
        type="button"
        class="rounded-full border border-border px-3 py-0.5 text-ui text-foreground transition-colors hover:bg-hover disabled:opacity-50"
        disabled={projectId === null}
        onclick={() => ask(askStarter(norm))}
      >
        {norm}
      </button>
    {/each}
  </div>
</div>
