<script lang="ts">
  import type { ModelStatus } from '@tagma/server/speech/contract/wire/status';
  import Card from './Card.svelte';
  import Pick, { type Option } from './Pick.svelte';
  import Row from './Row.svelte';
  import { keep, modelKey, type Place, SPEECH, stood } from './values.js';
  import { unavailable } from './words.js';

  let { models, place }: { models: readonly ModelStatus[]; place: Place } = $props();

  type Chosen = { readonly provider?: string; readonly model?: string };

  const AUTO = 'auto';

  const again = $derived(models.filter((model) => model.again));
  const choice = $derived(stood<Chosen>(place.catalog, SPEECH.callAgain) ?? {});
  const picked = $derived(again.find((model) => model.provider === choice.provider && model.model === choice.model));
  const problem = $derived(picked?.availability._tag === 'absent' ? unavailable(picked.availability) : null);
  const options = $derived<readonly Option[]>([
    { value: AUTO, label: 'A model for files that tells speakers apart' },
    ...again.map((model) => ({
      value: modelKey(model.provider, model.model),
      label: `${model.provider} · ${model.label}`,
      note: model.availability._tag === 'absent' ? 'unavailable' : model.speakers ? 'tells speakers apart' : 'one speaker',
    })),
  ]);

  function choose(value: string): void {
    const next = again.find((model) => modelKey(model.provider, model.model) === value);
    void keep(place, SPEECH.callAgain, next === undefined ? {} : { provider: next.provider, model: next.model });
  }
</script>

<Card title="Recognize calls again" fact="Models that hear the whole recorded sound of an ended call, not a live stream">
  <Row
    title="Model"
    hint="Recognize again in the Calls section uses it unless you pick another there; a model for files is paid work at its vendor."
    {problem}
    {place}
    settings={[SPEECH.callAgain]}
  >
    <Pick
      label="Recognize calls again with"
      value={picked === undefined ? AUTO : modelKey(picked.provider, picked.model)}
      {options}
      onwrite={choose}
    />
  </Row>
</Card>
