<script lang="ts">
  import { type ChatQuestionAnswer, type ChatQuestionPrompt, questionOpen, type ToolConfirmationEntry } from './entries';
  import { toolConfirmationPresentation } from '@runlith/agent/transcript/live';
  import { useChatRendering } from './renderers';
  import { useChatStrings } from './strings';
  import AnswerSending from './entries/AnswerSending.svelte';

  type Props = {
    confirmation: ToolConfirmationEntry;
    disabled?: boolean;
    onAnswer(questionId: string, answers: readonly ChatQuestionAnswer[]): void | Promise<void>;
  };

  let { confirmation, disabled = false, onAnswer }: Props = $props();
  const strings = useChatStrings();
  const button = useChatRendering().button;

  const VISIBLE_FACTS = 3;

  const prompts = $derived(confirmation.prompts);
  const settled = $derived(!questionOpen(confirmation));
  const locked = $derived(disabled || settled || confirmation.deliveryUnknown === true);
  const destructive = $derived(prompts.some((prompt) => toolConfirmationPresentation(prompt)?.intent === 'destructive'));

  const answerOptions = $derived.by(() => {
    const first = prompts[0]?.options ?? [];
    const shared = first.filter((option) =>
      prompts.every((prompt) => prompt.options?.some((candidate) => candidate.value === option.value)),
    );
    return [...shared].sort(
      (a, b) => (a.value === 'cancel' ? -1 : a.value === 'confirm' ? 1 : 0) - (b.value === 'cancel' ? -1 : b.value === 'confirm' ? 1 : 0),
    );
  });

  let expandedFacts = $state<Record<string, boolean>>({});

  function groupedLabel(option: { label: string; value: string }): string {
    if (prompts.length === 1) return option.label;
    if (option.value === 'confirm') return strings.confirmAll();
    return option.label;
  }

  function visibleFacts(prompt: ChatQuestionPrompt) {
    const facts = toolConfirmationPresentation(prompt)?.facts ?? [];
    return expandedFacts[prompt.id] ? facts : facts.slice(0, VISIBLE_FACTS);
  }

  function hiddenFactCount(prompt: ChatQuestionPrompt): number {
    const facts = toolConfirmationPresentation(prompt)?.facts ?? [];
    return expandedFacts[prompt.id] ? 0 : Math.max(0, facts.length - VISIBLE_FACTS);
  }

  function settledLabel(prompt: ChatQuestionPrompt): string {
    const given = confirmation.answers ?? confirmation.sending?.answers;
    const values = given?.find((entry) => entry.questionId === prompt.id)?.values ?? [];
    if (values.length === 0) return strings.noAnswerSubmitted();
    return values.map((value) => prompt.options?.find((option) => option.value === value)?.label ?? value).join(', ');
  }

  function answer(value: string): void {
    if (locked) return;
    void onAnswer(
      confirmation.questionId,
      prompts.map((prompt) => ({ questionId: prompt.id, values: [value] })),
    );
  }
</script>

{#snippet consequenceLine(prompt: ChatQuestionPrompt)}
  {@const consequence = toolConfirmationPresentation(prompt)?.consequence}
  {#if consequence}
    <p class="mt-0.5 text-small leading-5 text-muted-foreground">{consequence}</p>
  {/if}
{/snippet}

{#snippet factsList(prompt: ChatQuestionPrompt)}
  {#if visibleFacts(prompt).length > 0}
    <dl class="grid max-h-48 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 overflow-y-auto text-small leading-5">
      {#each visibleFacts(prompt) as fact (fact.label)}
        <dt class="text-muted-foreground">{fact.label}</dt>
        <dd class="break-words font-medium text-foreground">{fact.value}</dd>
      {/each}
    </dl>
    {#if hiddenFactCount(prompt) > 0}
      <button
        type="button"
        class="mt-1 w-fit border-b border-dashed border-border text-small text-muted-foreground hover:text-foreground"
        onclick={() => {
          expandedFacts = { ...expandedFacts, [prompt.id]: true };
        }}
      >
        {strings.showMoreFacts(hiddenFactCount(prompt))}
      </button>
    {/if}
  {/if}
{/snippet}

{#snippet answerButtons()}
  {#each answerOptions as choice (choice.value)}
    {@render button({
      control: choice.value === 'cancel' ? 'cancel' : 'confirm',
      ...(choice.value === 'confirm' ? { destructive } : {}),
      type: 'button',
      label: groupedLabel(choice),
      disabled: locked,
      onclick: () => answer(choice.value),
    })}
  {/each}
{/snippet}

{#if settled}
  <div class="mr-auto grid w-full min-w-0 max-w-feed gap-0.5">
    {#each prompts as prompt (prompt.id)}
      <p class="flex flex-wrap items-baseline gap-x-2 gap-y-0 text-ui text-muted-foreground/70">
        <span class="min-w-0 max-w-full break-words">{prompt.prompt}</span>
        <span class="shrink-0">· <span class="text-muted-foreground">{settledLabel(prompt)}</span></span>
      </p>
    {/each}
    {#if confirmation.decision?.by !== undefined}
      <p class="text-ui text-muted-foreground/70">{strings.decidedBy(confirmation.decision.by, confirmation.decision.note)}</p>
    {:else if confirmation.decision?.note !== undefined}
      <p class="text-ui text-muted-foreground/70">{confirmation.decision.note}</p>
    {/if}
    {#if confirmation.deliveryNote !== undefined}
      <p class="text-ui text-muted-foreground/70">{confirmation.deliveryNote}</p>
    {/if}
    {#if confirmation.sending !== undefined}
      <AnswerSending sending={confirmation.sending} />
    {/if}
  </div>
{:else}
  <section class="rounded-lg border border-primary/35 bg-chat-raised p-3">
    <div class="text-small font-semibold text-primary">
      {strings.confirmation()}{prompts.length > 1 ? ` · ${prompts.length}` : ''}
    </div>
    <p class="text-small text-muted-foreground">{strings.askedOf(confirmation.approver ?? null)}</p>
    {#if confirmation.deliveryNote !== undefined}
      <p class="mt-1 text-small text-muted-foreground">{confirmation.deliveryNote}</p>
    {/if}
    {#if prompts.length === 1 && prompts[0]}
      {@const prompt = prompts[0]}
      <div class="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div class="min-w-56 flex-1">
          {#if prompt.header}<p class="break-words text-small text-muted-foreground">{prompt.header}</p>{/if}
          <p class="break-words text-body font-semibold leading-6 text-foreground">{prompt.prompt}</p>
          {@render consequenceLine(prompt)}
        </div>
        <div class="ml-auto flex gap-2">
          {@render answerButtons()}
        </div>
      </div>
      {#if (toolConfirmationPresentation(prompt)?.facts?.length ?? 0) > 0}
        <div class="mt-2 border-t border-border pt-2">
          {@render factsList(prompt)}
        </div>
      {/if}
    {:else}
      <div class="mt-2 grid max-h-64 gap-2 overflow-y-auto">
        {#each prompts as prompt (prompt.id)}
          <div class="flex gap-2">
            <span class="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true"></span>
            <div class="min-w-0">
              <p class="break-words text-body font-semibold leading-6 text-foreground">{prompt.prompt}</p>
              {@render consequenceLine(prompt)}
              {@render factsList(prompt)}
            </div>
          </div>
        {/each}
      </div>
      <div class="mt-3 flex justify-end gap-2">
        {@render answerButtons()}
      </div>
    {/if}
  </section>
{/if}
