<script lang="ts">
  import type { ProfileId } from '@tagma/server/browser/contract/wire/ids';
  import type { Profile } from '@tagma/server/browser/contract/wire/profile';
  import Group from '$lib/features/settings/Group.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import type { OperationAnswer, OperationInput } from '$lib/wire/operation.js';
  import { type Refusal, refusalOf } from '$lib/wire/refusal.js';
  import { Door } from '$lib/wire/Door.js';

  let { profiles }: { profiles: readonly Profile[] } = $props();

  type Listed = OperationAnswer<'list_cookie_sources'>;
  type Imported = OperationAnswer<'import_cookies'>;
  type Source =
    | {
        readonly key: string;
        readonly label: string;
        readonly kind: 'browser';
        readonly browser: string;
        readonly profile: string;
        readonly access: Listed['browsers'][number]['access'];
      }
    | { readonly key: string; readonly label: string; readonly kind: 'tagma'; readonly profile: ProfileId }
    | { readonly key: string; readonly label: string; readonly kind: 'file' };

  const SHOWN_DOMAINS = 12;
  const FILE: Source = { key: 'file', label: 'A JSON cookie file…', kind: 'file' };

  const door = Door.use();
  const lens = {};

  let listed = $state.raw<Listed | null>(null);
  let listing = $state<Refusal | null>(null);
  let target = $state<ProfileId | ''>('');
  let chosen = $state('');
  let path = $state('');
  let busy = $state(false);
  let outcome = $state.raw<{ readonly into: string; readonly imported: Imported } | null>(null);
  let refused = $state.raw<Refusal | null>(null);

  const into = $derived(target === '' ? profiles[0]?.id : target);
  const browsers = $derived(
    (listed?.browsers ?? []).flatMap((browser) =>
      browser.profiles.map((profile): Source => ({
        key: `browser ${browser.id} ${profile.id}`,
        label: browser.profiles.length === 1 ? browser.title : `${browser.title} — ${profile.name}`,
        kind: 'browser',
        browser: browser.id,
        profile: profile.id,
        access: browser.access,
      })),
    ),
  );
  const tagmas = $derived(
    profiles
      .filter((profile) => profile.id !== into)
      .map((profile): Source => ({ key: `tagma ${profile.id}`, label: `Tagma — ${profile.name}`, kind: 'tagma', profile: profile.id })),
  );
  const unreadable = $derived((listed?.browsers ?? []).filter((browser) => browser.unreadable !== null));
  const source = $derived([...browsers, ...tagmas, FILE].find((held) => held.key === chosen) ?? browsers[0] ?? tagmas[0] ?? FILE);
  const hint = $derived(
    source.kind !== 'browser' || source.access === null
      ? null
      : source.access === 'full-disk'
        ? 'macOS keeps these cookies behind Full Disk Access. If they cannot be read, turn it on in System Settings → Privacy & Security → Full Disk Access for Tagma, or for your terminal when the Tagma server runs from it.'
        : 'macOS asks whether Tagma may read this browser’s key from the Keychain. The Tagma app has to be open: it reads the key.',
  );
  const nameOf = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? id;

  $effect(() => {
    door.perform('list_cookie_sources', {}, lens).then(
      (answer) => {
        listed = answer;
      },
      (error: unknown) => {
        listing = refusalOf(error);
      },
    );
  });

  function inputOf(profile: ProfileId): OperationInput<'import_cookies'> | null {
    switch (source.kind) {
      case 'browser':
        return { profile, browser: source.browser, browserProfile: source.profile };
      case 'tagma':
        return { profile, from: source.profile };
      case 'file':
        return path.trim() === '' ? null : { profile, file: path.trim() };
    }
  }

  async function start(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const profile = into;
    const input = profile === undefined ? null : inputOf(profile);
    if (profile === undefined || input === null) return;
    busy = true;
    refused = null;
    outcome = null;
    try {
      outcome = { into: nameOf(profile), imported: await door.perform('import_cookies', input, lens) };
    } catch (error) {
      refused = refusalOf(error);
    } finally {
      busy = false;
    }
  }

  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
</script>

<Group title="Import sign-ins">
  <form class="grid gap-3 py-3 text-ui" onsubmit={start}>
    <p class="text-small text-muted-foreground">
      Copies the cookies of another browser or profile, so its sign-ins work here. Google sign-ins never cross: Google ends a moved session
      within about an hour, so sign in to Google inside Tagma.
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <select class="h-8 min-w-0 flex-1 rounded-md bg-field px-2 text-ui" bind:value={chosen} aria-label="Import from">
        {#each [...browsers, ...tagmas, FILE] as held (held.key)}<option value={held.key}>{held.label}</option>{/each}
      </select>
      <span class="text-small text-muted-foreground">into</span>
      <select class="h-8 min-w-0 flex-1 rounded-md bg-field px-2 text-ui" bind:value={target} aria-label="Import into">
        {#each profiles as profile (profile.id)}<option value={profile.id}>{profile.name}</option>{/each}
      </select>
      <Button type="submit" size="sm" disabled={busy || into === undefined || (source.kind === 'file' && path.trim() === '')}>
        {busy ? 'Importing…' : 'Import'}
      </Button>
    </div>
    {#if source.kind === 'file'}
      <Input class="h-8" bind:value={path} placeholder="/Users/you/cookies.json" aria-label="Cookie file path" />
    {/if}
    {#if hint !== null}<p class="text-small text-muted-foreground">{hint}</p>{/if}
    {#if listed === null && listing === null}
      <p class="text-small text-muted-foreground">Looking for browsers on this Mac…</p>
    {:else if listing !== null}
      <p class="text-small text-destructive">The browsers on this machine were not listed: {listing.reason}</p>
    {:else if browsers.length === 0}
      <p class="text-small text-muted-foreground">No browser with cookies was found on this machine.</p>
    {/if}
    {#each unreadable as browser (browser.id)}
      <p class="text-small text-muted-foreground">{browser.title} could not be read: {browser.unreadable}</p>
    {/each}
    {#if outcome !== null}
      {@const done = outcome.imported}
      <div class="grid gap-1" role="status">
        <p>Imported {plural(done.written, 'cookie', 'cookies')} into {outcome.into}.</p>
        {#if done.google > 0}
          <p class="text-small text-muted-foreground">
            Left out {plural(done.google, 'Google cookie', 'Google cookies')}: sign in to Google inside Tagma.
          </p>
        {/if}
        {#if done.unreadable > 0}
          <p class="text-small text-muted-foreground">
            {plural(done.unreadable, 'cookie', 'cookies')} could not be read: encrypted with a key Tagma cannot use or kept in a partition it
            does not record.
          </p>
        {/if}
        {#if done.rejected > 0}
          <p class="text-small text-muted-foreground">
            {plural(done.rejected, 'cookie was', 'cookies were')} refused by the browser store and not imported.
          </p>
        {/if}
        {#if done.domains.length > 0}
          <p class="text-small text-muted-foreground">
            Replaced the cookies of {done.domains.slice(0, SHOWN_DOMAINS).join(', ')}{done.domains.length > SHOWN_DOMAINS
              ? ` and ${done.domains.length - SHOWN_DOMAINS} more`
              : ''}.
          </p>
        {/if}
      </div>
    {/if}
    {#if refused !== null}
      <div class="grid gap-1" role="alert">
        <p class="text-destructive">{refused.reason}</p>
        {#each refused.unblock as step, at (at)}<p class="text-small text-muted-foreground">{step}</p>{/each}
      </div>
    {/if}
  </form>
</Group>
