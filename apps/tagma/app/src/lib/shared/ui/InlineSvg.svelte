<script lang="ts">
  let { svg, label, class: className = '', style = '' }: { svg: string; label?: string; class?: string; style?: string } = $props();
</script>

<span
  class="inline-svg inline-flex shrink-0 {className}"
  {style}
  role={label === undefined ? undefined : 'img'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
>
  {@html svg}
</span>

<style>
  .inline-svg :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
