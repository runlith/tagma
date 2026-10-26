<script lang="ts">
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { cn } from '$lib/shared/utils.js';
  import { type Choice, plural } from './words.js';

  let {
    open = $bindable(false),
    count,
    blocking,
    canKeep,
    busy = false,
    ondecide,
  }: { open?: boolean; count: number; blocking: boolean; canKeep: boolean; busy?: boolean; ondecide: (choice: Choice) => void } = $props();

  let choice = $state<Choice>('fix');

  $effect(() => {
    if (open) choice = canKeep ? 'keep' : 'fix';
  });

  const one = $derived(count === 1);

  const options = $derived([
    ...(canKeep
      ? [
          {
            value: 'keep' as const,
            title: one ? 'Keep it as known' : 'Keep them as known',
            detail: `${one ? 'It stays' : 'They stay'}, owned by a new task, and ${one ? 'does' : 'do'} not block commits.`,
          },
        ]
      : []),
    {
      value: 'fix' as const,
      title: one ? 'Fix it first' : 'Fix them first',
      detail: 'A new thread opens with the request to an agent, ready for you to send; the rule stays as it is.',
    },
    ...(blocking
      ? [
          {
            value: 'leave' as const,
            title: 'Block anyway',
            detail: `${one ? 'It keeps' : 'They keep'} standing as slipped through; only new violations are refused.`,
          },
        ]
      : []),
  ] satisfies readonly { value: Choice; title: string; detail: string }[]);
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title class="text-page">{blocking ? 'Make this rule block commits' : 'Keep what slipped through'}</Dialog.Title>
      <Dialog.Description>
        {plural(count, 'violation')} already slipped through. {blocking
          ? `From now on a commit that adds a new one is refused — decide what happens to ${one ? 'it' : 'these'}.`
          : `Decide what happens to ${one ? 'it' : 'them'}.`}
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-2" role="radiogroup" aria-label="What happens to them">
      {#each options as option (option.value)}
        <button
          type="button"
          role="radio"
          aria-checked={choice === option.value}
          class={cn(
            'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
            choice === option.value ? 'border-brand/50 bg-hover' : 'border-border hover:bg-hover',
          )}
          onclick={() => (choice = option.value)}
        >
          <span
            class={cn(
              'mt-0.5 size-4 shrink-0 rounded-full border',
              choice === option.value ? 'border-4 border-brand' : 'border-vein-strong',
            )}
          ></span>
          <span class="min-w-0">
            <span class="block text-ui font-medium text-foreground">{option.title}</span>
            <span class="block text-small text-muted-foreground">{option.detail}</span>
          </span>
        </button>
      {/each}
    </div>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
      <Button disabled={busy} onclick={() => ondecide(choice)}>
        {choice === 'fix' ? 'Ask an agent' : blocking ? 'Block commits' : 'Keep as known'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
