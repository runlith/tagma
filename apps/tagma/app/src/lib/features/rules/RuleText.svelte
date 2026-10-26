<script lang="ts">
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Asking } from '$lib/features/threads/Asking.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { cn } from '$lib/shared/utils.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { useHere } from './here.js';
  import { RulesRepo } from './Repo.js';
  import StrictnessSwitch from './Strictness.svelte';
  import { askCheck, plural, type Strictness } from './words.js';

  let { name }: { name: string } = $props();

  const asking = Asking.use();
  const repo = RulesRepo.use();
  const blocks = BlocksRepo.use();
  const tags = TagCatalog.use();
  const notices = Notices.use();
  const here = useHere();

  let choosing = $state(false);
  let target = $state<Strictness>('watch');
  let key = $state<string | null>(null);
  let busy = $state(false);

  const keys = $derived(repo.config.data?.config?.inspections ?? []);

  function pick(strictness: Strictness): void {
    target = strictness;
    key = null;
    choosing = true;
  }

  function askAgent(): void {
    choosing = false;
    const place = here.ask();
    if (place !== null) void asking.draft(place, askCheck(name));
  }

  async function use(chosen: string): Promise<void> {
    busy = true;
    let owner: string | undefined;
    try {
      const found = await repo.trial.run({ inspection: chosen, blockId: name }, { throwOnError: true });
      const count = found?.total ?? 0;
      const work = tags.workTag;
      if (count > 0 && work !== null) {
        const task = await blocks.create.run(
          { parentId: name, tags: [work], title: `Remove the ${plural(count, 'violation')} this rule found when it became a check` },
          { throwOnError: true },
        );
        owner = task?.name;
      }
      await repo.enforce.run(
        { blockId: name, base: null, strictness: target, inspection: chosen, on: [{ op: 'submit_work', phase: 'before' }], owner },
        { throwOnError: true },
      );
      choosing = false;
    } catch (error) {
      notices.refusal(error);
      if (owner !== undefined) await blocks.trash.run(owner).catch((left: unknown) => notices.refusal(left));
    } finally {
      busy = false;
    }
  }
</script>

<section class="mt-8 border-t border-vein pt-5">
  <StrictnessSwitch current="note" onpick={pick} />
  <p class="mt-4 max-w-prose text-ui leading-relaxed text-muted-foreground">
    No commit is checked against it yet. To warn or block, the rule needs a check: a key of <code class="font-mono">tagma.config.ts</code>
    that measures it, or an agent who finds one and shows what it would catch.
  </p>
  <Button class="mt-3" size="sm" variant="outline" onclick={() => pick('watch')}>Make it a check</Button>
</section>

<Dialog.Root bind:open={choosing}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title class="text-page">{target === 'gate' ? 'Block commits by a check' : 'Warn by a check'}</Dialog.Title>
      <Dialog.Description
        >Pick the check that measures this rule. What it finds now becomes known violations owned by a new task.</Dialog.Description
      >
    </Dialog.Header>
    {#if keys.length > 0}
      <div class="grid max-h-64 gap-1 overflow-y-auto" role="radiogroup" aria-label="Checks in tagma.config.ts">
        {#each keys as one (one.key)}
          <button
            type="button"
            role="radio"
            aria-checked={key === one.key}
            class={cn(
              'flex items-baseline gap-3 rounded-md px-3 py-1.5 text-left transition-colors',
              key === one.key ? 'bg-selected' : 'hover:bg-hover',
            )}
            onclick={() => (key = one.key)}
          >
            <span class="font-mono text-ui text-foreground">{one.key}</span>
            <FadeText class="min-w-0 text-small text-muted-foreground" text={one.inspection} />
          </button>
        {/each}
      </div>
    {:else}
      <p class="text-ui text-muted-foreground">
        <code class="font-mono">tagma.config.ts</code> at HEAD declares no check yet.
      </p>
    {/if}
    <Dialog.Footer>
      <Button variant="ghost" onclick={askAgent}>Ask Tagma to find one</Button>
      <Button disabled={key === null || busy} onclick={() => key !== null && void use(key)}>Use this check</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
