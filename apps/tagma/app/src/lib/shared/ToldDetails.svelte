<script lang="ts">
  import { cn } from '$lib/shared/utils.js';
  import type { Told } from '$lib/wire/told.js';

  let { told, class: className, linked }: { told: Told; class?: string; linked?: (name: string) => string } = $props();

  const parts = (line: string): readonly { readonly text: string; readonly name: boolean }[] =>
    line.split(/\b([0-9a-f]{8})\b/).map((text, index) => ({ text, name: index % 2 === 1 }));
</script>

<div class={cn('grid min-w-0 gap-0.5 select-text', className)} data-told-details>
  {#each told.details as line, index (index)}
    <p class="text-small wrap-anywhere text-foreground/70">
      {#if linked === undefined}
        {line}
      {:else}
        {#each parts(line) as part, at (at)}
          {#if part.name}
            <a class="stamp text-foreground underline-offset-4 hover:underline" href={linked(part.text)}>{part.text}</a>
          {:else}
            {part.text}
          {/if}
        {/each}
      {/if}
    </p>
  {/each}
  {#if told.code !== undefined}
    <p class="stamp wrap-anywhere text-muted-foreground">{told.code}</p>
  {/if}
</div>
