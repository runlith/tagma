<script lang="ts">
  import type { ModelStatus } from '@tagma/server/speech/contract/wire/status';
  import { Host } from '@runlith/layer/Host';
  import { spellModifier } from '$lib/shared/chordSpelling.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import ChordControl from '$lib/features/shortcuts/ChordControl.svelte';
  import Card from './Card.svelte';
  import { HOLD } from './dictation/action.js';
  import Pick, { type Option } from './Pick.svelte';
  import Row from './Row.svelte';
  import { keep, modelKey, SPEECH, stood, type Place, type RecognizerChoice } from './values.js';
  import { unavailable } from './words.js';

  let { models, place }: { models: readonly ModelStatus[]; place: Place } = $props();

  const SHARED = 'shared';
  const host = Host.use();
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

  function choose(value: string): void {
    const next = recognizers.find((model) => modelKey(model.provider, model.model) === value);
    void keep(place, SPEECH.dictationRecognizer, next === undefined ? {} : { provider: next.provider, model: next.model });
  }
</script>

{#snippet keyHint()}Hold to speak, release to insert; a short tap records until the next press. <Kbd
    chord={spellModifier('shift', host.apple)}
    size="sm"
  /> on release also sends in the agent field.{#if host.isDesktop}
    Work in every app dictates into whatever app is focused: a pill at the bottom of the screen shows what is heard, and on release the text
    is pasted where the cursor is.{/if}{/snippet}

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
  <Row title="Dictation key" hint={keyHint}>
    <ChordControl action={HOLD} />
  </Row>
</Card>
