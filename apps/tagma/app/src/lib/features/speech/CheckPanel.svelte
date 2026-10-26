<script lang="ts">
  import type { DevicesStatus } from '@tagma/server/speech/contract/wire/status';
  import { SystemSettings } from '$lib/shared/SystemSettings.js';
  import Told from '$lib/shared/Told.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Card from './Card.svelte';
  import { Check } from './Check.svelte.js';
  import { fault, readiness, type Source } from './check.js';
  import Said from './Said.svelte';
  import TrackRow from './TrackRow.svelte';
  import { told } from './words.js';

  let { devices }: { devices: DevicesStatus } = $props();

  const check = Check.use();
  const systemSettings = SystemSettings.find();
  const SOURCES: readonly Source[] = ['mic', 'system'];

  let chosen = $state<readonly Source[]>(['mic']);

  $effect(() => () => check.stop());

  const ready = $derived(chosen.map((source) => ({ source, fault: readiness(source, devices) })));

  function toggle(source: Source): void {
    chosen = chosen.includes(source) ? chosen.filter((one) => one !== source) : [...chosen, source];
  }
</script>

<Card title="Check" fact={check.running ? 'Listening — say a phrase' : 'Say a phrase and see the text; nothing is saved'}>
  {#snippet act()}
    {#if check.running}
      <Button variant="outline" size="sm" onclick={() => check.stop()}>Stop</Button>
    {:else}
      <Button size="sm" disabled={chosen.length === 0} onclick={() => check.start(chosen)}>Start check</Button>
    {/if}
  {/snippet}

  <div class="flex flex-wrap items-center gap-4 py-3">
    {#each SOURCES as source (source)}
      <label class="flex items-center gap-2 text-ui">
        <input type="checkbox" checked={chosen.includes(source)} disabled={check.running} onchange={() => toggle(source)} />
        {source === 'mic' ? 'Microphone' : 'System audio'}
      </label>
    {/each}
  </div>

  {#if !check.running}
    {#each ready as { source, fault: blocked } (source)}
      {#if blocked !== null}
        {@const message = told(blocked, source)}
        <div class="flex items-center gap-3 border-t border-vein py-2">
          <div class="grid min-w-0 flex-1 gap-0.5">
            <span class="text-ui font-medium text-destructive">{message.title}</span>
            <span class="text-small text-muted-foreground">{message.detail}</span>
            {#if message.details !== undefined && message.details.length > 0}
              <Told told={{ text: '', details: message.details }} />
            {/if}
          </div>
          {#if message.settings !== undefined && systemSettings !== undefined}
            {@const page = message.settings}
            <Button variant="outline" size="sm" onclick={() => systemSettings.open(page)}>Open Settings</Button>
          {/if}
        </div>
      {/if}
    {/each}
  {/if}

  {#if check.stopped !== null}
    <div class="border-t border-vein py-2 text-destructive" role="alert">
      <Told told={check.stopped} />
    </div>
  {/if}

  {#if check.running || Object.keys(check.run.tracks).length > 0}
    {#each check.asked as source (source)}
      <TrackRow
        {source}
        view={check.run.tracks[source]}
        fault={fault(check.run.tracks[source], check.startedAt, check.now)}
        running={check.running}
      />
    {/each}
    <Said said={check.run.said} gaps={check.run.gaps} />
  {/if}
</Card>
