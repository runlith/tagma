<script lang="ts">
  import type { ChatQuestionAnswer, ChatQuestionPrompt } from './entries';
  import { useChatStrings } from './strings';

  type Draft = { values: string[]; done: boolean };

  let {
    prompts,
    answers = undefined,
    locked,
    onSubmit,
  }: {
    prompts: readonly ChatQuestionPrompt[];
    answers?: readonly ChatQuestionAnswer[];
    locked: boolean;
    onSubmit: (answers: readonly ChatQuestionAnswer[]) => void;
  } = $props();

  const strings = useChatStrings();

  let drafts = $state<Record<string, Draft>>({});
  let freeform = $state<Record<string, string>>({});
  const submitted = $derived(new Map((answers ?? []).map((answer) => [answer.questionId, answer])));
  const activeId = $derived(locked ? null : (prompts.find((prompt) => !drafts[prompt.id]?.done)?.id ?? null));

  function completePrompt(prompt: ChatQuestionPrompt, values: string[]): void {
    if (locked || values.length === 0) return;
    drafts = { ...drafts, [prompt.id]: { values, done: true } };
    if (prompts.every((candidate) => drafts[candidate.id]?.done)) {
      onSubmit(prompts.map((candidate) => ({ questionId: candidate.id, values: [...(drafts[candidate.id]?.values ?? [])] })));
    }
  }

  function tapOption(prompt: ChatQuestionPrompt, value: string): void {
    if (locked) return;
    if (!prompt.allowMultiple) {
      completePrompt(prompt, [value]);
      return;
    }
    const current = drafts[prompt.id]?.values ?? [];
    const values = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    drafts = { ...drafts, [prompt.id]: { values, done: false } };
  }

  function submitFreeform(prompt: ChatQuestionPrompt): void {
    const text = (freeform[prompt.id] ?? '').trim();
    if (!text) return;
    const picked = prompt.allowMultiple ? [...(drafts[prompt.id]?.values ?? []), text] : [text];
    completePrompt(prompt, picked);
  }

  function pickedValues(prompt: ChatQuestionPrompt): readonly string[] {
    return drafts[prompt.id]?.values ?? [];
  }

  function answeredLabels(prompt: ChatQuestionPrompt): readonly string[] {
    const values = submitted.get(prompt.id)?.values ?? (drafts[prompt.id]?.done ? drafts[prompt.id]?.values : null);
    if (!values || values.length === 0) return [];
    if (prompt.secret) return ['•••'];
    return values.map((value) => prompt.options?.find((option) => option.value === value)?.label ?? value);
  }
</script>

<div class="mr-auto grid w-full min-w-0 max-w-feed gap-2">
  {#each prompts as prompt (prompt.id)}
    {@const done = locked || Boolean(drafts[prompt.id]?.done) || submitted.has(prompt.id)}
    {#if done || prompt.id === activeId}
      {@const labels = answeredLabels(prompt)}
      <div class="grid gap-2">
        {#if prompt.header}
          <div class="text-small font-medium text-muted-foreground">{prompt.header}</div>
        {/if}
        <p class={['whitespace-pre-wrap break-words text-body leading-6', done ? 'text-muted-foreground' : 'text-foreground']}>
          {prompt.prompt}
        </p>
        {#if done}
          {#if labels.length > 0}
            <div class="ml-auto min-w-0 max-w-[min(85%,72ch)] rounded-lg rounded-br-md bg-foreground/8 px-3 py-2 text-foreground">
              <p class="whitespace-pre-wrap break-words text-body leading-6">{labels.join(', ')}</p>
            </div>
          {:else if locked}
            <p class="text-ui text-muted-foreground">{strings.noAnswerSubmitted()}</p>
          {/if}
        {:else}
          {#if prompt.options?.length}
            <div class="flex flex-wrap gap-2">
              {#each prompt.options as option (`${prompt.id}:${option.value}`)}
                {@const picked = pickedValues(prompt).includes(option.value)}
                <button
                  type="button"
                  aria-pressed={picked}
                  class={[
                    'cursor-pointer border text-left text-ui transition pointer-coarse:min-h-11',
                    option.description ? 'rounded-lg px-3 py-2' : 'rounded-full px-3 py-1.5',
                    picked
                      ? 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border bg-background/65 text-foreground hover:bg-hover',
                  ]}
                  onclick={() => tapOption(prompt, option.value)}
                >
                  <span class="font-medium">{option.label}</span>
                  {#if option.description}
                    <span class="block text-small font-normal leading-5 text-muted-foreground">{option.description}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
          {#if prompt.allowMultiple && pickedValues(prompt).length > 0}
            <div>
              <button
                type="button"
                class="cursor-pointer rounded-full bg-primary px-4 py-1.5 pointer-coarse:min-h-11 text-ui font-semibold text-primary-foreground transition hover:opacity-90"
                onclick={() => completePrompt(prompt, [...pickedValues(prompt)])}
              >
                {strings.done()} · {pickedValues(prompt).length}
              </button>
            </div>
          {/if}
          {#if prompt.allowFreeform || !prompt.options?.length}
            <input
              type={prompt.secret ? 'password' : 'text'}
              value={freeform[prompt.id] ?? ''}
              class="w-full max-w-md rounded-full border border-border bg-background px-3 py-1.5 pointer-coarse:min-h-11 text-ui outline-none transition placeholder:text-muted-foreground/55 focus:border-foreground/40"
              placeholder={strings.typeYourAnswer()}
              autocomplete="off"
              oninput={(event) => {
                freeform = { ...freeform, [prompt.id]: event.currentTarget.value };
              }}
              onkeydown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submitFreeform(prompt);
              }}
            />
          {/if}
        {/if}
      </div>
    {/if}
  {/each}
</div>
