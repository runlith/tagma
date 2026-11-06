<script lang="ts">
  import { cn } from '$lib/shared/utils.js';

  let { src, class: className }: { src: string; class: string } = $props();

  const mask = $derived(`url("${src}") center / contain no-repeat`);
</script>

<span class={cn('block bg-current', className)} style:mask style:-webkit-mask={mask} aria-hidden="true"></span>
