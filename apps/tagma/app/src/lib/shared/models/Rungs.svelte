<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { ModelStep } from './choice.js';

  let {
    steps,
    model,
    pressed,
    disabled = false,
    onpress,
    ...rest
  }: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
    steps: readonly ModelStep[];
    model: string;
    pressed: (step: string) => boolean;
    disabled?: boolean;
    onpress: (step: string) => void;
  } = $props();

  const press =
    (step: string): Attachment<HTMLButtonElement> =>
    (button) => {
      const click = (event: MouseEvent): void => {
        event.stopPropagation();
        onpress(step);
      };
      button.addEventListener('click', click);
      return () => button.removeEventListener('click', click);
    };
</script>

<span {...rest} class="flex shrink-0 gap-px rounded-md bg-hover p-0.5" role="group" aria-label="Reasoning">
  {#each steps as one (one.id)}
    <button
      type="button"
      tabindex="-1"
      class={[
        'h-5 rounded-sm px-1.5 text-small font-medium transition-colors pointer-coarse:h-9 pointer-coarse:px-3',
        pressed(one.id) ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
      ]}
      aria-label={`${model} at ${one.label}`}
      aria-pressed={pressed(one.id)}
      {disabled}
      {@attach press(one.id)}
    >
      {one.short}
    </button>
  {/each}
</span>
