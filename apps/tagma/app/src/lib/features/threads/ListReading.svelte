<script lang="ts">
  const TITLES = [62, 78, 48, 70, 56, 84, 44, 66];
</script>

<div class="reading" role="status" aria-label="Reading agents">
  {#each TITLES as width, index (index)}
    <div class="flex items-center gap-1.5 py-1 pr-2 pl-1.5" aria-hidden="true">
      <span class="size-3.5 shrink-0"></span>
      <span class="flex h-4.5 min-w-0 flex-1 items-center">
        <span class="h-2 rounded-full bg-vein-strong" style:width="{width}%"></span>
      </span>
      <span class="h-2 w-12 shrink-0 rounded-full bg-vein"></span>
      <span class="h-2 w-4 shrink-0 rounded-full bg-vein"></span>
    </div>
  {/each}
</div>

<style>
  .reading {
    opacity: 0;
    animation:
      reading-appear 160ms ease-out 120ms forwards,
      reading-breathe 1.6s ease-in-out 280ms infinite;
  }

  @keyframes reading-appear {
    to {
      opacity: 1;
    }
  }

  @keyframes reading-breathe {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
</style>
