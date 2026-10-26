<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import type { BrowserIdentity, Identities } from '@tagma/desktop/bridge';
  import type { ProfileId } from '@tagma/server/browser/contract/wire/ids';
  import type { Profile } from '@tagma/server/browser/contract/wire/profile';
  import Group from '$lib/features/settings/Group.svelte';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { Door } from '$lib/wire/Door.js';
  import { DesktopPages } from '../DesktopPages.svelte.js';
  import CookieImport from './CookieImport.svelte';
  import ProfileRow from './ProfileRow.svelte';

  let { catalog, scope, project }: SectionProps = $props();

  const door = Door.use();
  const desktop = DesktopPages.use();
  const lens = {};

  let profiles = $state.raw<readonly Profile[] | null>(null);
  let problem = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let name = $state('');
  let adapter = $state('');
  let identities = $state.raw<Identities | null>(null);

  const adapters = $derived([...new Set((profiles ?? []).map((profile) => profile.adapter))].sort());

  async function act(key: string, work: () => Promise<unknown>): Promise<void> {
    busy = key;
    problem = null;
    try {
      await work();
      profiles = (await door.perform('list_profiles', {}, lens)).profiles;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      busy = null;
    }
  }

  $effect(() => {
    void act('list', async () => undefined);
  });

  $effect(() => {
    void desktop.bridge?.identity().then((held) => {
      identities = held;
    });
  });

  function create(event: SubmitEvent): void {
    event.preventDefault();
    const made = name.trim();
    const on = adapter || adapters[0];
    if (made === '' || on === undefined) return;
    void act('create', async () => {
      await door.perform('create_profile', { name: made, adapter: on }, lens);
      name = '';
    });
  }

  const rename = (profile: ProfileId, renamed: string) =>
    act(profile, () => door.perform('update_profile', { profile, name: renamed }, lens));
  const clear = (profile: ProfileId) => act(profile, () => door.perform('clear_profile', { profile }, lens));
  const remove = (profile: ProfileId) => act(profile, () => door.perform('delete_profile', { profile }, lens));

  function choose(identity: BrowserIdentity): void {
    desktop.bridge?.chooseIdentity(identity);
    if (identities !== null) identities = { ...identities, chosen: identity };
  }
</script>

<KeyCard entries={catalog.entriesOf('browser')} {catalog} {scope} {project} />

<Group title="Profiles">
  {#if profiles === null}
    <p class="py-3 text-ui text-muted-foreground">{problem ?? 'Reading the profiles…'}</p>
  {:else}
    <div class="grid divide-y">
      {#each profiles as profile (profile.id)}
        <ProfileRow
          {profile}
          busy={busy === profile.id}
          rename={(renamed) => void rename(profile.id, renamed)}
          clear={() => void clear(profile.id)}
          remove={() => void remove(profile.id)}
        />
      {/each}
    </div>
    <form class="flex items-center gap-2 py-3" onsubmit={create}>
      <Input class="h-8 min-w-0 flex-1" bind:value={name} placeholder="New profile name" aria-label="New profile name" maxlength={80} />
      {#if adapters.length > 1}
        <select class="h-8 rounded-md bg-field px-2 text-ui" bind:value={adapter} aria-label="Host of the new profile">
          {#each adapters as one (one)}<option value={one}>{one}</option>{/each}
        </select>
      {/if}
      <Button type="submit" size="sm" disabled={busy !== null || name.trim() === ''}><Plus class="size-3.5" />Add</Button>
    </form>
    {#if problem !== null}<p class="pb-3 text-small text-destructive">{problem}</p>{/if}
  {/if}
</Group>

{#if profiles !== null && profiles.length > 0}
  <CookieImport {profiles} />
{/if}

{#if identities !== null}
  <Group title="How desktop pages introduce themselves">
    <div class="grid gap-2 py-3 text-ui">
      <label class="flex items-start gap-2">
        <input type="radio" name="identity" checked={identities.chosen === 'cleaned'} onchange={() => choose('cleaned')} />
        <span class="grid"
          ><span>As Chrome</span><span class="text-small text-muted-foreground"
            >Sites see a plain Chrome; sign-ins at Google, X and LinkedIn keep working.</span
          ></span
        >
      </label>
      <label class="flex items-start gap-2">
        <input type="radio" name="identity" checked={identities.chosen === 'native'} onchange={() => choose('native')} />
        <span class="grid"
          ><span>As Tagma</span><span class="text-small text-muted-foreground">Sites see Electron and Tagma in the user agent.</span></span
        >
      </label>
      {#if identities.chosen !== identities.applied}
        <p class="text-small text-muted-foreground">Takes effect when Tagma restarts.</p>
      {/if}
    </div>
  </Group>
{/if}
