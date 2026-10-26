<script lang="ts">
  import type { ModelStatus } from '@tagma/server/speech/contract/wire/status';
  import Pick, { type Option } from './Pick.svelte';
  import Row from './Row.svelte';
  import { keep, languageName, modelKey, SPEECH, stood, type Place, type VoiceChoice } from './values.js';

  let { models, place }: { models: readonly ModelStatus[]; place: Place } = $props();

  const catalog = $derived(place.catalog);

  const AUTO = 'auto';

  const voices = $derived(models.filter((model) => model.kind === 'synthesis'));
  const choice = $derived(stood<VoiceChoice>(catalog, SPEECH.voice) ?? {});
  const picked = $derived(voices.find((model) => model.provider === choice.provider && model.model === choice.model));
  const problem = $derived.by(() => {
    if (picked?.availability._tag !== 'absent') return null;
    const { reason, unblock } = picked.availability;
    return [reason, ...unblock].join(' · ');
  });

  const modelOptions = $derived<readonly Option[]>([
    { value: AUTO, label: 'Chosen by capability' },
    ...voices.map((model) => ({
      value: modelKey(model.provider, model.model),
      label: `${model.provider} · ${model.label}`,
      note: model.availability._tag === 'absent' ? 'unavailable' : undefined,
    })),
  ]);
  const voiceOptions = $derived<readonly Option[]>([
    { value: AUTO, label: 'Model default' },
    ...(picked?.voices ?? []).map((voice) => ({ value: voice.id, label: voice.label })),
  ]);
  const languageOptions = $derived<readonly Option[]>([
    { value: AUTO, label: 'Follow the text' },
    ...(picked?.languages ?? []).map((code) => ({ value: code, label: languageName(code), note: code })),
  ]);

  function chooseModel(value: string): void {
    const next = voices.find((model) => modelKey(model.provider, model.model) === value);
    void keep(place, SPEECH.voice, next === undefined ? {} : { provider: next.provider, model: next.model });
  }

  function chooseField(field: 'voice' | 'language', value: string): void {
    const { [field]: _, ...rest } = choice;
    void keep(place, SPEECH.voice, value === AUTO ? rest : { ...rest, [field]: value });
  }
</script>

<Row title="Voice model" hint="The model speech is synthesized with when a request names none." {problem} {place} settings={[SPEECH.voice]}>
  <Pick
    label="Voice model"
    value={picked === undefined ? AUTO : modelKey(picked.provider, picked.model)}
    options={modelOptions}
    onwrite={chooseModel}
  />
</Row>

{#if picked !== undefined}
  <Row title="Voice" {place} settings={[SPEECH.voice]}>
    <Pick label="Voice" value={choice.voice ?? AUTO} options={voiceOptions} onwrite={(value) => chooseField('voice', value)} />
  </Row>
  <Row title="Voice language" {place} settings={[SPEECH.voice]}>
    <Pick
      label="Voice language"
      value={choice.language ?? AUTO}
      options={languageOptions}
      onwrite={(value) => chooseField('language', value)}
    />
  </Row>
{/if}
