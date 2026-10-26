<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { pick, type SectionProps } from '$lib/features/settings/section.js';
  import Card from './Card.svelte';
  import CallAgain from './CallAgain.svelte';
  import CallSound from './CallSound.svelte';
  import CheckPanel from './CheckPanel.svelte';
  import Devices from './Devices.svelte';
  import Languages from './Languages.svelte';
  import LocalModels from './LocalModels.svelte';
  import Recognizer from './Recognizer.svelte';
  import { SpeechRepo } from './Repo.js';
  import Speak from './Speak.svelte';
  import { SPEECH, type Place } from './values.js';
  import Voice from './Voice.svelte';
  import VoiceInput from './VoiceInput.svelte';

  let { catalog, scope, project }: SectionProps = $props();

  const speech = SpeechRepo.use();
  const place = $derived<Place>({ catalog, scope, project, reload: () => speech.status.refresh() });
  const status = $derived(speech.status.data);
  const failed = $derived(speech.status.error);
</script>

<div class="grid">
  {#if status === undefined}
    <Card title="Speech" fact={failed == null ? 'Reading what this machine can do…' : 'Could not be read'}>
      {#if failed != null}
        <div class="flex items-center gap-3 py-3">
          <p class="flex-1 text-ui text-destructive">{failed.message}</p>
          <Button variant="outline" size="sm" onclick={() => void speech.status.refresh()}>Retry</Button>
        </div>
      {/if}
    </Card>
  {:else}
    <Card title="Defaults">
      <Recognizer models={status.models} {place} />
      <Languages models={status.models} {place} />
      <Voice models={status.models} {place} />
    </Card>
    <VoiceInput models={status.models} {place} />
    <KeyCard
      title="Calls"
      entries={pick(catalog.entriesOf('speech'), [SPEECH.callTracks, SPEECH.callSpeakers])}
      {catalog}
      {scope}
      {project}
    />
    <CallSound {place} />
    <CallAgain models={status.models} {place} />
    <Devices devices={status.devices} {place} />
    <KeyCard title="Speech boundaries" entries={pick(catalog.entriesOf('speech'), [SPEECH.segmenter])} {catalog} {scope} {project} />
    <LocalModels local={status.local} />
    <CheckPanel devices={status.devices} />
    <Speak />
  {/if}
</div>
