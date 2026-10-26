<script lang="ts">
  import { onDestroy } from 'svelte';

  import { log, Teaser } from './fixtures.js';

  const teaser = Teaser.use();
  log.push(`guest-consumer:${teaser.scope.closed ? 'closed' : 'open'}`);
  onDestroy(() => log.push('guest-consumer-destroyed'));
</script>

<span data-testid="guest">guest</span>
