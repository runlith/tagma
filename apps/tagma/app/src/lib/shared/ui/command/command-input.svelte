<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search';
  import { onDestroy, untrack } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import * as InputGroup from '$lib/shared/ui/input-group/index.js';
  import { cn } from '$lib/shared/utils.js';
  import { Listing } from './listing.svelte.js';

  let { class: className, value = $bindable(''), placeholder }: { class?: ClassValue; value?: string; placeholder?: string } = $props();

  const listing = Listing.use();
  untrack(() => (listing.inputs += 1));
  onDestroy(() => untrack(() => (listing.inputs -= 1)));

  $effect(() => {
    listing.query = value;
  });
</script>

<div data-slot="command-input-wrapper" class="p-1 pb-0">
  <InputGroup.Root class="bg-input/30 border-input/30 h-8! rounded-md! shadow-none! *:data-[slot=input-group-addon]:pl-2!">
    <InputGroup.Input
      bind:value
      {placeholder}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded="true"
      aria-controls={listing.id}
      autocomplete="off"
      spellcheck="false"
      data-slot="command-input"
      class={cn('w-full text-ui outline-hidden disabled:cursor-not-allowed disabled:opacity-50', className)}
      {@attach listing.collection.field}
    />
    <InputGroup.Addon>
      <SearchIcon class="size-3.5 shrink-0 opacity-50" />
    </InputGroup.Addon>
  </InputGroup.Root>
</div>
