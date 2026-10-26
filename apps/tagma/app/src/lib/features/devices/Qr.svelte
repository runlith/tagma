<script lang="ts">
  import { encode } from 'uqr';

  let { value, label }: { value: string; label: string } = $props();

  const QUIET_ZONE = 2;

  const code = $derived(encode(value, { ecc: 'M', border: QUIET_ZONE }));
  const path = $derived(code.data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join(''));
</script>

<svg
  viewBox="0 0 {code.size} {code.size}"
  class="size-full rounded-md bg-qr-paper"
  shape-rendering="crispEdges"
  role="img"
  aria-label={label}
>
  <path d={path} class="fill-qr-ink" />
</svg>
