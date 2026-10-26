<script lang="ts">
  import type { Profile } from '@tagma/server/browser/contract/wire/profile';
  import { Button } from '$lib/shared/ui/button/index.js';

  let {
    profile,
    busy,
    rename,
    clear,
    remove,
  }: { profile: Profile; busy: boolean; rename: (name: string) => void; clear: () => void; remove: () => void } = $props();

  let name = $state('');
  let editing = $state(false);

  function done(): void {
    editing = false;
    const renamed = name.trim();
    if (renamed !== '' && renamed !== profile.name) rename(renamed);
  }
</script>

<div class="flex min-h-11 items-center gap-3 py-2" data-profile={profile.id}>
  <span class={['size-2 shrink-0 rounded-full', profile.connected ? 'bg-primary' : 'bg-muted-foreground']} aria-hidden="true"></span>
  <div class="grid min-w-0 flex-1">
    {#if editing}
      <input
        class="h-7 rounded-md bg-field px-2 text-ui"
        bind:value={name}
        aria-label="Profile name"
        maxlength={80}
        onblur={done}
        onkeydown={(event) => {
          if (event.key === 'Enter') done();
          else if (event.key === 'Escape') editing = false;
        }}
        {@attach (field) => field.focus()}
      />
    {:else}
      <button
        type="button"
        class="truncate text-left text-ui hover:underline"
        onclick={() => {
          name = profile.name;
          editing = true;
        }}>{profile.name}</button
      >
    {/if}
    <span class="truncate text-small text-muted-foreground">
      {profile.id} · {profile.adapter}{profile.connected ? '' : ' · its host is not connected'}{profile.removal === null
        ? ''
        : ` · ${profile.removal === 'delete' ? 'deleted' : 'cleared'} when its host connects`}
    </span>
  </div>
  <Button size="sm" variant="ghost" disabled={busy} onclick={clear}>Clear data</Button>
  <Button size="sm" variant="ghost" disabled={busy} onclick={remove}>Delete</Button>
</div>
