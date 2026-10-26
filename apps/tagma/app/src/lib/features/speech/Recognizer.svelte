<script lang="ts">
  import type { ModelStatus } from '@tagma/server/speech/contract/wire/status';
  import Pick, { type Option } from './Pick.svelte';
  import Row from './Row.svelte';
  import { keep, modelKey, SPEECH, stood, type Place, type RecognizerChoice, type Tuning } from './values.js';
  import Knob from './Knob.svelte';

  let { models, place }: { models: readonly ModelStatus[]; place: Place } = $props();

  const catalog = $derived(place.catalog);

  const AUTO = 'auto';
  const TURNS = { provider: 'By the provider', client: 'By Tagma', none: 'No turns' } as const;

  const recognizers = $derived(models.filter((model) => model.kind === 'recognition'));
  const choice = $derived(stood<RecognizerChoice>(catalog, SPEECH.recognizer) ?? {});
  const picked = $derived(recognizers.find((model) => model.provider === choice.provider && model.model === choice.model));
  const tuning = $derived(stood<Tuning>(catalog, SPEECH.tuning) ?? {});
  const problem = $derived.by(() => {
    if (picked?.availability._tag !== 'absent') return null;
    const { reason, unblock } = picked.availability;
    return [reason, ...unblock].join(' · ');
  });

  const options = $derived<readonly Option[]>([
    { value: AUTO, label: 'Chosen by capability' },
    ...recognizers.map((model) => ({
      value: modelKey(model.provider, model.model),
      label: `${model.provider} · ${model.label}`,
      note: model.availability._tag === 'absent' ? 'unavailable' : undefined,
    })),
  ]);

  const turnOptions = $derived<readonly Option[]>([
    { value: AUTO, label: 'Default' },
    ...(picked?.turns ?? []).map((turn) => ({ value: turn, label: TURNS[turn] })),
  ]);

  function chooseModel(value: string): void {
    const next = recognizers.find((model) => modelKey(model.provider, model.model) === value);
    if (next === undefined) return void keep(place, SPEECH.recognizer, {});
    const turns = choice.turns !== undefined && next.turns.includes(choice.turns) ? { turns: choice.turns } : {};
    void keep(place, SPEECH.recognizer, { provider: next.provider, model: next.model, ...turns });
  }

  function chooseTurns(value: string): void {
    const { turns: _, ...rest } = choice;
    void keep(place, SPEECH.recognizer, value === AUTO ? rest : { ...rest, turns: value });
  }

  function tune(model: ModelStatus, id: string, value: number): void {
    const key = modelKey(model.provider, model.model);
    void keep(place, SPEECH.tuning, { ...tuning, [key]: { ...tuning[key], [id]: value } });
  }
</script>

<Row
  title="Recognizer"
  hint="The model a listening or a check run recognizes with when it names none."
  {problem}
  {place}
  settings={[SPEECH.recognizer]}
>
  <Pick label="Recognizer" value={picked === undefined ? AUTO : modelKey(picked.provider, picked.model)} {options} onwrite={chooseModel} />
</Row>

{#if picked !== undefined}
  <Row title="Turns" hint="Who decides where one turn of speech ends." {place} settings={[SPEECH.recognizer]}>
    <Pick label="Turns" value={choice.turns ?? AUTO} options={turnOptions} onwrite={chooseTurns} />
  </Row>
  {#each picked.tuning.filter((knob) => choice.turns === undefined || knob.modes.includes(choice.turns)) as knob (knob.id)}
    <Row title={knob.label} {place} settings={[SPEECH.tuning]}>
      <Knob
        {knob}
        value={tuning[modelKey(picked.provider, picked.model)]?.[knob.id] ?? knob.initial}
        onwrite={(value) => tune(picked, knob.id, value)}
      />
    </Row>
  {/each}
{/if}
