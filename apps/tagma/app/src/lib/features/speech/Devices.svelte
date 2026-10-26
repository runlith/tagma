<script lang="ts">
  import type { DevicesStatus } from '@tagma/server/speech/contract/wire/status';
  import { SystemSettings } from '$lib/shared/SystemSettings.js';
  import Told from '$lib/shared/Told.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Card from './Card.svelte';
  import Pick, { type Option } from './Pick.svelte';
  import Row from './Row.svelte';
  import { SpeechRepo } from './Repo.js';
  import { keep, SPEECH, stood, type Place } from './values.js';

  let { devices, place }: { devices: DevicesStatus; place: Place } = $props();

  const catalog = $derived(place.catalog);

  const speech = SpeechRepo.use();
  const systemSettings = SystemSettings.find();

  const DEFAULT = 'default';
  const PANES = {
    mic: { title: 'Microphone access', page: 'microphone' },
    system: { title: 'System audio access', page: 'system-audio' },
  } as const;
  const WORDS = {
    granted: 'Allowed',
    denied: 'Denied',
    'not-asked': 'Not asked yet — the first capture asks',
    unknown: 'Unknown',
  } as const;

  const chosen = $derived(stood<string | null>(catalog, SPEECH.microphone) ?? null);
  const missing = $derived(chosen !== null && !devices.inputs.some((input) => input.id === chosen));
  const options = $derived<readonly Option[]>([
    { value: DEFAULT, label: 'System default' },
    ...devices.inputs.map((input) => ({ value: input.id, label: input.label })),
    ...(missing && chosen !== null ? [{ value: chosen, label: chosen, note: 'not connected' }] : []),
  ]);
  const fact = $derived(devices.availability._tag === 'present' ? 'Capture is available' : 'Recording is not available');
</script>

<Card title="Audio on this machine" {fact}>
  {#snippet act()}
    <Button variant="outline" size="sm" onclick={() => void speech.status.refresh()}>Refresh</Button>
  {/snippet}
  {#if devices.said !== null}
    <div class="border-b border-vein py-2 text-destructive">
      <Told
        told={{
          text: devices.said,
          details: [
            ...(devices.availability._tag === 'absent' ? [devices.availability.reason, ...devices.availability.unblock] : []),
            ...(devices.refusal === null ? [] : [devices.refusal]),
          ],
        }}
      />
    </div>
  {/if}
  <Row title="Microphone" hint="The input a microphone track captures when it names none." {place} settings={[SPEECH.microphone]}>
    <Pick
      label="Microphone"
      value={chosen ?? DEFAULT}
      {options}
      disabled={devices.inputs.length === 0 && chosen === null}
      onwrite={(id) => void keep(place, SPEECH.microphone, id === DEFAULT ? null : id)}
    />
  </Row>
  {#each ['mic', 'system'] as const as source (source)}
    {@const state = devices.permissions?.[source]}
    {@const pane = PANES[source]}
    <Row title={pane.title}>
      <span class="text-ui {state === 'denied' ? 'text-destructive' : 'text-muted-foreground'}">
        {!devices.capabilities[source] ? 'Not available on this machine' : state === undefined ? 'Not reported' : WORDS[state]}
      </span>
      {#if systemSettings !== undefined && devices.capabilities[source] && (state === 'denied' || state === 'unknown')}
        <Button variant="outline" size="sm" class="justify-start" onclick={() => systemSettings.open(pane.page)}>Open Settings</Button>
      {/if}
    </Row>
  {/each}
</Card>
