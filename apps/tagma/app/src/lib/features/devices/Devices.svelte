<script lang="ts">
  import Globe from '@lucide/svelte/icons/globe';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Moon from '@lucide/svelte/icons/moon';
  import { untrack } from 'svelte';
  import { Platform } from '@runlith/layer/Platform';
  import { Awake } from '$lib/features/power/Awake.svelte.js';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import { machineName, rememberMachine } from '$lib/features/shell/machine.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Blocked from './Blocked.svelte';
  import Copy from './Copy.svelte';
  import DeviceRow from './DeviceRow.svelte';
  import { Push } from './Push.svelte.js';
  import { DevicesRepo } from './Repo.js';

  const REMOTE_ENABLED = 'remote.enabled';
  const EXPIRY_GRACE_MS = 250;

  const repo = DevicesRepo.use();
  const push = Push.use();
  const settings = SettingsRepo.use();
  const workspace = Workspace.use();
  const awake = Awake.use();
  const clock = WallClock.use();
  const storage = Platform.use().storage.local;

  const access = $derived(repo.access.data);
  const listed = $derived(repo.devices.data);
  const machine = $derived(access?.machine ?? machineName(storage));
  const remote = $derived(access !== undefined && access.device !== null);
  const phase = $derived(access?.state);
  const pairing = $derived(access?.pairing ?? null);
  const ready = $derived(phase?._tag === 'ready');
  const expiresAt = $derived(pairing?.expiresAt ?? null);
  const reported = $derived(access?.machine);
  const hold = $derived(awake.standing);
  const unheld = $derived(hold !== null && (hold.state._tag === 'unavailable' || hold.state._tag === 'failed') ? hold.state.reason : null);
  const sleeps = $derived(hold !== null && (hold.mode !== 'always' || unheld !== null));
  const holdable = $derived(hold !== null && hold.mode !== 'always' && hold.state._tag !== 'unavailable');

  let switching = $state(false);
  let removing = $state<string | null>(null);
  let problem = $state<string | null>(null);
  let issuing = false;
  let shownCode: string | null = null;

  $effect(() => clock.watchMinutes());

  $effect(() => {
    if (reported !== undefined) rememberMachine(storage, reported);
  });

  $effect(() => {
    if (!ready) return;
    if (expiresAt === null) {
      untrack(() => void issue());
      return;
    }
    const timer = setTimeout(() => void repo.access.refresh(), Date.parse(expiresAt) - Date.now() + EXPIRY_GRACE_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const code = pairing?.code ?? null;
    untrack(() => {
      if (shownCode !== null && code !== shownCode) void repo.devices.refresh();
      shownCode = code;
    });
  });

  function said(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught);
  }

  async function issue(): Promise<void> {
    if (issuing) return;
    issuing = true;
    try {
      await repo.pairing.run(undefined, { throwOnError: true });
      await repo.access.refresh();
      problem = null;
    } catch (caught) {
      problem = said(caught);
    } finally {
      issuing = false;
    }
  }

  async function allow(value: boolean): Promise<void> {
    const projectId = workspace.contextProject?.id;
    if (projectId === undefined) {
      problem = 'Add a project first: settings are written through one.';
      return;
    }
    switching = true;
    problem = null;
    try {
      await settings.write.run({ projectId, scope: 'user', key: REMOTE_ENABLED, value }, { throwOnError: true });
      await repo.access.refresh();
    } catch (caught) {
      problem = said(caught);
    } finally {
      switching = false;
    }
  }

  async function remove(device: string): Promise<void> {
    removing = device;
    problem = null;
    try {
      await repo.revoke.run(device, { throwOnError: true });
      await repo.devices.refresh();
    } catch (caught) {
      problem = said(caught);
    } finally {
      removing = null;
    }
  }
</script>

<div class="grid gap-4">
  {#if access === undefined}
    {#if repo.access.error}
      <p class="text-ui text-destructive">Phone access could not be read: {said(repo.access.error)}</p>
    {:else}
      <div class="h-24 animate-pulse rounded-lg border bg-raised" aria-hidden="true"></div>
    {/if}
  {:else}
    <div class="overflow-hidden rounded-lg border bg-raised">
      {#if !remote}
        <div class="flex items-center gap-4 px-3 py-3 pointer-coarse:px-4">
          <div class="grid min-w-0 flex-1 gap-0.5">
            <p class="text-ui font-medium pointer-coarse:text-body">Allow access from your phone</p>
            <p class="text-small text-muted-foreground">
              Reach the agents on {machine} from anywhere, through Tailscale. Paired devices only.
            </p>
          </div>
          <SwitchControl
            label="Allow access from your phone"
            value={access.enabled}
            disabled={switching}
            onwrite={(value) => void allow(value)}
          />
        </div>
      {/if}

      {#if access.enabled}
        <div class:border-t={!remote}>
          {#if phase?._tag === 'setting-up' || phase?._tag === 'certificate'}
            <div class="flex items-center gap-2 px-3 py-3 text-ui text-muted-foreground pointer-coarse:px-4">
              <Waiting class="size-4" />
              {#if phase._tag === 'setting-up'}
                Setting up…
              {:else}
                Getting a certificate… the first one takes up to a minute.
              {/if}
            </div>
          {:else if phase?._tag === 'blocked'}
            <Blocked blocked={phase} {machine} onretry={() => void repo.access.refresh()} />
          {:else if phase?._tag === 'ready'}
            <div class="flex min-w-0 items-center gap-2 border-b py-1 pr-1 pl-3 pointer-coarse:pl-4">
              <Globe class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate font-mono text-ui">{phase.origin}</span>
              <Copy text={phase.origin} label="Copy the address" />
            </div>
            <div class="flex flex-col items-center gap-4 p-4 sm:flex-row sm:items-center">
              <div class="size-40 shrink-0">
                {#if pairing !== null}
                  {#await import('./Qr.svelte') then { default: Qr }}
                    <Qr value={pairing.url} label="Pairing code for {machine}" />
                  {/await}
                {:else}
                  <div class="size-full animate-pulse rounded-md bg-sunken"></div>
                {/if}
              </div>
              <div class="grid min-w-0 gap-2 text-center sm:text-left">
                <p class="text-body font-medium">Pair a phone</p>
                <p class="text-ui text-muted-foreground">
                  Scan with the phone's camera. Where Tagma is already installed on the phone, type the code there.
                </p>
                <p class="font-mono text-title" aria-live="polite">{pairing?.code ?? '····-····'}</p>
                <p class="text-small text-muted-foreground">A fresh code comes every five minutes and after each pairing.</p>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if access.enabled && sleeps}
      <div class="flex items-start gap-3 rounded-lg border bg-raised px-3 py-3 pointer-coarse:px-4">
        <Moon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div class="grid min-w-0 flex-1 gap-1">
          <p class="text-ui pointer-coarse:text-body">While an agent waits for you, {machine} may sleep and your phone can't reach it.</p>
          {#if unheld !== null}
            <p class="text-small text-destructive">{unheld}</p>
          {:else if hold?.limit}
            <p class="text-small text-muted-foreground">{hold.limit}</p>
          {/if}
          {#if awake.problem !== null}
            <p class="text-small text-destructive">{awake.problem}</p>
          {/if}
        </div>
        {#if holdable}
          <Button
            variant="outline"
            size="sm"
            class="pointer-coarse:h-11 pointer-coarse:px-4"
            disabled={awake.choosing !== null}
            onclick={() => void awake.choose('always')}
          >
            Keep awake: Always
          </Button>
        {/if}
      </div>
    {/if}

    {#if listed !== undefined && listed.total > 0}
      <section class="grid gap-2">
        <h3 class="text-small font-medium text-muted-foreground">
          Paired devices · {listed.total}
        </h3>
        <ul class="divide-y overflow-hidden rounded-lg border bg-raised">
          {#each listed.devices as device (device.id)}
            <DeviceRow
              {device}
              current={device.id === access.device}
              notified={push.reading?.devices.includes(device.id) ?? false}
              removing={removing === device.id}
              now={clock.now}
              onremove={() => void remove(device.id)}
            />
          {/each}
        </ul>
        {#if listed.total > listed.shown}
          <p class="text-small text-muted-foreground">The {listed.shown} most recent of {listed.total}.</p>
        {/if}
      </section>
    {/if}
  {/if}

  {#if problem !== null}
    <p class="text-ui text-destructive">{problem}</p>
  {/if}
</div>
