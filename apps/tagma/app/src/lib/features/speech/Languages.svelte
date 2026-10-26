<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import type { ModelStatus } from '@tagma/server/speech/contract/wire/status';
  import Pick, { type Option } from './Pick.svelte';
  import Row from './Row.svelte';
  import { keep, languageName, SPEECH, stood, type Place, type RecognizerChoice } from './values.js';

  let { models, place }: { models: readonly ModelStatus[]; place: Place } = $props();

  const catalog = $derived(place.catalog);

  const ADD = 'add';

  const choice = $derived(stood<RecognizerChoice>(catalog, SPEECH.recognizer) ?? {});
  const chosen = $derived(stood<readonly string[]>(catalog, SPEECH.languages) ?? []);
  const known = $derived.by(() => {
    const recognition = models.filter((model) => model.kind === 'recognition');
    const named = recognition.filter((model) => model.provider === choice.provider && model.model === choice.model);
    return [...new Set((named.length > 0 ? named : recognition).flatMap((model) => model.languages))].sort();
  });
  const options = $derived<readonly Option[]>([
    { value: ADD, label: 'Add a language…' },
    ...known.filter((code) => !chosen.includes(code)).map((code) => ({ value: code, label: languageName(code), note: code })),
  ]);
</script>

<Row
  title="Spoken languages"
  {place}
  settings={[SPEECH.languages]}
  hint="Recognition is hinted with these, the likeliest first. With none, the recognizer detects the language."
>
  {#if chosen.length > 0}
    <ul class="flex flex-wrap gap-1.5">
      {#each chosen as code (code)}
        <li class="flex items-center gap-1 rounded-md border bg-sunken py-0.5 pr-1 pl-2 text-small">
          {languageName(code)}
          <button
            type="button"
            class="grid size-4 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
            aria-label="Remove {languageName(code)}"
            onclick={() =>
              void keep(
                place,
                SPEECH.languages,
                chosen.filter((one) => one !== code),
              )}
          >
            <X class="size-3" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <Pick
    label="Add a language"
    value={ADD}
    {options}
    onwrite={(code) => code !== ADD && void keep(place, SPEECH.languages, [...chosen, code])}
  />
</Row>
