<script lang="ts">
  import type { Piece } from '@tagma/server/speech/contract/wire/listening';
  import AudioLines from '@lucide/svelte/icons/audio-lines';
  import X from '@lucide/svelte/icons/x';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { pieceKey } from './piece.js';

  let {
    pieces,
    documents,
    onRemovePiece,
    onRemoveDocument,
  }: {
    pieces: readonly Piece[];
    documents: readonly { readonly id: string; readonly title: string }[];
    onRemovePiece: (key: string) => void;
    onRemoveDocument: (id: string) => void;
  } = $props();

  const cards = $derived([
    ...pieces.map((piece) => ({
      key: `piece:${pieceKey(piece)}`,
      title: piece.title,
      count: piece.utterances,
      hint: piece.span === null ? 'Remove the piece; it stays new on the call' : 'Remove the selected span',
      remove: () => onRemovePiece(pieceKey(piece)),
    })),
    ...documents.map((document) => ({
      key: `document:${document.id}`,
      title: document.title,
      count: null,
      hint: 'Remove the document',
      remove: () => onRemoveDocument(document.id),
    })),
  ]);
</script>

{#if cards.length > 0}
  <div class="flex flex-wrap gap-1.5 pb-1">
    {#each cards as card (card.key)}
      <span class="flex min-w-0 items-center gap-1.5 rounded-lg border bg-raised py-1 pr-1 pl-2 text-small">
        <AudioLines class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="max-w-64 truncate">{card.title}</span>
        {#if card.count !== null}<span class="shrink-0 tabular-nums text-muted-foreground">{card.count}</span>{/if}
        <Tooltip text={card.hint}>
          <button
            type="button"
            class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            aria-label="Remove call piece"
            onclick={card.remove}
          >
            <X class="size-3" />
          </button>
        </Tooltip>
      </span>
    {/each}
  </div>
{/if}
