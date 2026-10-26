<script lang="ts">
  import { type ChatQuestionAnswer, questionOpen } from '../entries';
  import { toolConfirmationFromEntry } from '../entryProjection';
  import type { ChatEntryOf } from '../renderers';
  import ToolConfirmation from '../ToolConfirmation.svelte';
  import UserQuestion from '../UserQuestion.svelte';
  import AnswerSending from './AnswerSending.svelte';

  type Props = {
    entry: ChatEntryOf<'question'>;
    disabled?: boolean;
    onAnswer(questionId: string, answers: readonly ChatQuestionAnswer[]): void | Promise<void>;
  };

  let { entry, disabled = false, onAnswer }: Props = $props();

  const confirmation = $derived(toolConfirmationFromEntry(entry));
</script>

{#if confirmation}
  <ToolConfirmation {confirmation} {disabled} onAnswer={(questionId, answers) => void onAnswer(questionId, answers)} />
{:else}
  <UserQuestion
    prompts={entry.prompts}
    answers={entry.answers ?? entry.sending?.answers}
    locked={!questionOpen(entry)}
    onSubmit={(answers) => void onAnswer(entry.questionId, answers)}
  />
  {#if entry.sending !== undefined}
    <AnswerSending sending={entry.sending} />
  {/if}
{/if}
