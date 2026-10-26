<script lang="ts">
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { LinkAct } from './Link.js';
  import { linkOpened } from './linkTarget.js';
  import { Opening } from './Opening.svelte.js';

  const opening = Opening.use();
  const notices = Notices.use();

  const aim = $derived(opening.aim);
  const shape = $derived(aim === null ? null : opening.shape(aim.link, aim.app, aim.click));

  function run(act: () => void | Promise<void>, opens: boolean): void {
    const origin = aim?.origin;
    opening.closeMenu();
    if (opens && origin !== undefined) linkOpened(origin);
    Promise.resolve()
      .then(act)
      .catch((error: unknown) => notices.refusal(error));
  }
</script>

{#snippet acts(list: readonly LinkAct[], opens: boolean)}
  {#each list as act (act.id)}
    <DropdownMenu.Item icon={act.icon} onSelect={() => run(act.run, opens)} data-link-act={act.id}>{act.words}</DropdownMenu.Item>
  {/each}
{/snippet}

<DropdownMenu.Root bind:open={() => aim !== null && shape !== null, (next) => !next && opening.closeMenu()}>
  <DropdownMenu.Content
    anchor={aim === null ? undefined : { x: aim.x, y: aim.y }}
    class="w-60"
    align="start"
    sideOffset={0}
    data-link-menu={aim?.link.kind}
  >
    {#if shape !== null}
      {#each shape.steps as step (step.how)}
        <DropdownMenu.Item icon={step.icon} keys={step.keys} onSelect={() => run(step.run, true)} data-link-step={step.how}>
          {step.words}
        </DropdownMenu.Item>
      {/each}
      {#if shape.places.length > 0}
        <DropdownMenu.Separator />
        {@render acts(shape.places, true)}
      {/if}
      {#if shape.copies.length > 0}
        <DropdownMenu.Separator />
        {@render acts(shape.copies, false)}
      {/if}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
