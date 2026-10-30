<script lang="ts">
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ThreadsRepo } from '../Repo.js';
  import { moveTransport, transportOffer } from './transport.js';

  let { row, projectId, part }: { row: ThreadListRow; projectId: number; part: 'act' | 'note' } = $props();
  const threads = ThreadsRepo.use();
  const notices = Notices.use();

  const offer = $derived(transportOffer(row));
  let moving = $state(false);

  async function move(): Promise<void> {
    if (offer === null || offer.to === null || moving) return;
    moving = true;
    try {
      const refusal = await moveTransport(threads, projectId, row.id, offer.to);
      if (refusal !== null) notices.error(offer.move ?? offer.label, refusal);
    } finally {
      moving = false;
    }
  }
</script>

{#if offer !== null}
  {#if offer.to === null}
    {#if part === 'note'}
      <DropdownMenu.Separator />
      <DropdownMenu.Note text={offer.label} title={offer.hint} />
    {/if}
  {:else if part === 'act'}
    <DropdownMenu.Item
      icon={moving ? Waiting : offer.to === 'terminal' ? SquareTerminal : ArrowRightLeft}
      title={offer.turning ? 'A turn is running — it moves once the turn ends or is stopped.' : offer.hint}
      disabled={moving || offer.turning}
      onSelect={() => void move()}
    >
      {offer.move ?? offer.label}
    </DropdownMenu.Item>
  {/if}
{/if}
