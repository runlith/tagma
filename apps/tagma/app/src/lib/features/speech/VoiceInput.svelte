<script lang="ts">
  import type { ModelStatus } from '@tagma/server/speech/contract/wire/status';
  import { Host } from '@runlith/layer/Host';
  import { spellKey, spellModifier } from '$lib/shared/chordSpelling.js';
  import { SystemSettings } from '$lib/shared/SystemSettings.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import type { Told } from '$lib/wire/told.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import Card from './Card.svelte';
  import { chordLabel, chordOf, DEFAULT_CHORD, written } from './dictation/chord.js';
  import { Global } from './dictation/Global.svelte.js';
  import Pick, { type Option } from './Pick.svelte';
  import Row from './Row.svelte';
  import { keep, modelKey, SPEECH, stood, type Place, type RecognizerChoice } from './values.js';
  import { unavailable } from './words.js';

  let { models, place }: { models: readonly ModelStatus[]; place: Place } = $props();

  const SHARED = 'shared';
  const apple = Host.use().apple;
  const catalog = $derived(place.catalog);
  const recognizers = $derived(models.filter((model) => model.kind === 'recognition'));
  const choice = $derived(stood<RecognizerChoice>(catalog, SPEECH.dictationRecognizer) ?? {});
  const picked = $derived(recognizers.find((model) => model.provider === choice.provider && model.model === choice.model));
  const problem = $derived(picked?.availability._tag === 'absent' ? unavailable(picked.availability) : null);
  const options = $derived<readonly Option[]>([
    { value: SHARED, label: 'The default recognizer' },
    ...recognizers.map((model) => ({
      value: modelKey(model.provider, model.model),
      label: `${model.provider} · ${model.label}`,
      note: model.availability._tag === 'absent' ? 'unavailable' : undefined,
    })),
  ]);

  const key = $derived(stood<string>(catalog, SPEECH.dictationKey) ?? DEFAULT_CHORD);
  const chord = $derived(chordOf(key));
  const global = Global.use();
  const systemSettings = SystemSettings.find();
  const everywhere = $derived(stood<boolean>(catalog, SPEECH.globalDictation) === true);
  const globalKey = $derived(stood<string>(catalog, SPEECH.globalKey) ?? DEFAULT_CHORD);
  const globalChord = $derived(chordOf(globalKey));
  const globalProblem = $derived.by((): Told | null => {
    if (!everywhere) return null;
    if (global.state.kind === 'untrusted')
      return {
        text: 'Tagma is not allowed to hear the key in other apps and paste there. Allow Tagma under Accessibility in System Settings.',
        details: [],
      };
    if (global.state.kind === 'unavailable') return { text: 'Global dictation cannot start on this Mac.', details: [global.state.reason] };
    return null;
  });
  let recording = $state<typeof SPEECH.dictationKey | typeof SPEECH.globalKey | null>(null);

  function allowAccessibility(): void {
    global.prompt();
    systemSettings?.open('accessibility');
  }

  function choose(value: string): void {
    const next = recognizers.find((model) => modelKey(model.provider, model.model) === value);
    void keep(place, SPEECH.dictationRecognizer, next === undefined ? {} : { provider: next.provider, model: next.model });
  }

  function capture(event: KeyboardEvent): void {
    const setting = recording;
    if (setting === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      recording = null;
      return;
    }
    const chordText = written(event);
    if (chordText === null || chordOf(chordText) === null) return;
    recording = null;
    void keep(place, setting, chordText);
  }
</script>

<svelte:window onkeydowncapture={capture} />

{#snippet keyHint()}Hold to speak, release to insert; a short tap records until the next press. <Kbd
    chord={spellModifier('shift', apple)}
    size="sm"
  /> on release also sends in the agent field.{/snippet}

{#snippet pressNew()}Press the new chord… <Kbd chord={spellKey('Escape', apple)} size="sm" /> cancels{/snippet}

<Card title="Voice input" fact="Hold the key or the microphone, speak, release: the text lands where the cursor is">
  <Row
    title="Dictation recognizer"
    hint="The model dictation recognizes with; languages, microphone and keys are shared with the rest of speech."
    {problem}
    {place}
    settings={[SPEECH.dictationRecognizer]}
  >
    <Pick
      label="Dictation recognizer"
      value={picked === undefined ? SHARED : modelKey(picked.provider, picked.model)}
      {options}
      onwrite={choose}
    />
  </Row>
  <Row title="Key in the window" hint={keyHint} {place} settings={[SPEECH.dictationKey]}>
    <Button
      variant="outline"
      size="sm"
      class="justify-start"
      aria-pressed={recording === SPEECH.dictationKey}
      onclick={() => (recording = recording === SPEECH.dictationKey ? null : SPEECH.dictationKey)}
    >
      {#if recording === SPEECH.dictationKey}{@render pressNew()}{:else if chord === null}{key}{:else}<Kbd
          chord={chordLabel(chord, apple)}
        />{/if}
    </Button>
    {#if key !== DEFAULT_CHORD}
      <button
        type="button"
        class="justify-self-start text-small text-muted-foreground underline-offset-4 hover:underline"
        onclick={() => void keep(place, SPEECH.dictationKey, DEFAULT_CHORD)}
      >
        Reset to <Kbd chord={chordLabel(chordOf(DEFAULT_CHORD)!, apple)} size="sm" />
      </button>
    {/if}
  </Row>
  {#if global.desktop !== undefined}
    <Row
      title="Global dictation"
      hint="Hold the key in any app: a pill at the bottom of the screen shows what is heard, and on release the text is pasted where the cursor is. In the Tagma window its own key works instead."
      problem={globalProblem}
      {place}
      settings={[SPEECH.globalDictation, SPEECH.globalKey]}
    >
      <div class="flex items-center gap-2">
        <SwitchControl label="Global dictation" value={everywhere} onwrite={(value) => void keep(place, SPEECH.globalDictation, value)} />
        {#if everywhere}
          <Button
            variant="outline"
            size="sm"
            class="flex-1 justify-start"
            aria-pressed={recording === SPEECH.globalKey}
            onclick={() => (recording = recording === SPEECH.globalKey ? null : SPEECH.globalKey)}
          >
            {#if recording === SPEECH.globalKey}{@render pressNew()}{:else if globalChord === null}{globalKey}{:else}<Kbd
                chord={chordLabel(globalChord, apple)}
              />{/if}
          </Button>
        {/if}
      </div>
      {#if everywhere && global.state.kind === 'untrusted' && systemSettings !== undefined}
        <Button variant="outline" size="sm" class="justify-start" onclick={allowAccessibility}>Open Settings</Button>
      {/if}
    </Row>
  {/if}
</Card>
