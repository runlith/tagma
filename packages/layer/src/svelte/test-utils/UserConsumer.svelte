<script lang="ts">
  import { onDestroy } from 'svelte';

  import { log, Profile } from './fixtures.js';

  const profile = Profile.use();
  log.push(`user-consumer:${profile.session.id}:${profile.scope.closed ? 'closed' : 'open'}`);
  onDestroy(() => log.push(`user-consumer-destroyed:${profile.session.id}`));
</script>

<span data-testid="user">{profile.session.id}</span>
