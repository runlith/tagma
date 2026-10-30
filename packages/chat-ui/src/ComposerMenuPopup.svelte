<script lang="ts">
  import { pieces } from '@runlith/search-text/match';
  import { tick } from 'svelte';
  import { clipFade } from './clipFade';
  import type { ComposerMenu, ComposerPick } from './ComposerMenu.svelte';
  import { useChatRendering } from './renderers';
  import { useChatStrings } from './strings';

  let {
    menu,
    menuId,
    element = $bindable(),
    onApply,
    onBack,
  }: {
    menu: ComposerMenu;
    menuId: string;
    element?: HTMLDivElement;
    onApply(pick: ComposerPick | null): void;
    onBack(): void;
  } = $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();
  const button = rendering.button;
  let optionsElement: HTMLDivElement | undefined = $state();

  $effect(() => {
    menu.options;
    const index = menu.active;
    void tick().then(() =>
      optionsElement?.querySelector<HTMLElement>(`[data-popup-option="${index}"]`)?.scrollIntoView({ block: 'nearest' }),
    );
  });
</script>

<div
  bind:this={element}
  data-composer-popup
  class="absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-raised"
>
  {#if menu.section}
    <div class="flex items-center justify-between gap-3 px-2 py-1 text-meta text-muted-foreground">
      <span class="font-mono">/{menu.section}</span><span class="flex items-center gap-1.5"
        >{@render rendering.key({ code: 'Escape', size: 'sm' })}{strings.goBack()}</span
      >
    </div>
  {:else if menu.kind === 'mention' && menu.provider?.label}
    <div class="px-2 py-1 font-mono text-meta text-muted-foreground">{menu.provider.label}</div>
  {/if}
  {#if menu.fields.length > 0}
    <div
      class="grid max-h-[min(20rem,52dvh)] gap-2 overflow-auto overscroll-contain p-2"
      onkeydowncapture={(event) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onBack();
      }}
    >
      {#each menu.fields as argument (argument.id)}
        <label class="grid gap-1">
          <span class="text-small font-medium text-muted-foreground">{argument.label}</span>
          {#if argument.options?.length}
            <select
              class="min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-ui text-foreground"
              value={menu.values[argument.id] ?? ''}
              onchange={(event) => (menu.values[argument.id] = event.currentTarget.value)}
            >
              {#each argument.options as option (option.id)}<option value={option.id} disabled={option.disabled}>{option.label}</option
                >{/each}
            </select>
          {:else if argument.multiline}
            <textarea
              rows="3"
              placeholder={argument.placeholder}
              class="min-w-0 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-ui text-foreground"
              value={menu.values[argument.id] ?? ''}
              oninput={(event) => (menu.values[argument.id] = event.currentTarget.value)}></textarea>
          {:else}
            <input
              type="text"
              placeholder={argument.placeholder}
              class="min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-ui text-foreground"
              value={menu.values[argument.id] ?? ''}
              oninput={(event) => (menu.values[argument.id] = event.currentTarget.value)}
              onkeydown={(event) => {
                if (event.key !== 'Enter' || event.isComposing) return;
                event.preventDefault();
                onApply(menu.form());
              }}
            />
          {/if}
        </label>
      {/each}
      <div class="flex justify-end pt-0.5">
        {@render button({
          control: 'confirm',
          type: 'button',
          label: `/${menu.section}`,
          disabled: !menu.formReady,
          onclick: () => onApply(menu.form()),
        })}
      </div>
    </div>
  {:else}
    <div
      bind:this={optionsElement}
      id={menuId}
      role="listbox"
      aria-label={menu.provider?.prefix ?? '/'}
      class="max-h-[min(16rem,42dvh)] overflow-auto overscroll-contain"
    >
      {#each menu.options as option, index (option.id)}
        <button
          type="button"
          role="option"
          id={`${menuId}-${index}`}
          aria-selected={index === menu.active}
          data-popup-option={index}
          disabled={option.disabled}
          class={[
            'completion-row w-full min-w-0 rounded-md text-left',
            option.disabled
              ? 'cursor-default text-foreground/40'
              : index === menu.active
                ? 'bg-selected text-foreground'
                : 'text-foreground/80 hover:bg-hover hover:text-foreground',
          ]}
          title={option.description}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => onApply(menu.pick(index))}
          onmouseenter={() => {
            if (!option.disabled) menu.active = index;
          }}
        >
          <span class="flex min-w-0 items-center gap-2">
            {#if menu.kind === 'mention' && menu.provider?.icon}{@render menu.provider.icon({
                id: option.id,
                label: option.label,
                description: option.description,
              })}{/if}
            <span
              class={['min-w-0 text-small', menu.provider?.accent && option.act !== true ? 'mention-label font-mono' : 'font-medium']}
              data-fade
              {@attach clipFade}
              >{#each pieces(option.label, option.hits ?? []) as piece, at (at)}{#if piece.hit}<span
                    class={['underline underline-offset-2', (!menu.provider?.accent || option.act === true) && 'text-foreground']}
                    >{piece.text}</span
                  >{:else}{piece.text}{/if}{/each}</span
            >
          </span>
          <span class="completion-description min-w-0 text-small text-muted-foreground" data-fade {@attach clipFade}
            >{option.description ?? ''}</span
          >
          <span class="justify-self-end">
            {#if option.value || (menu.command && option.active)}
              <span
                class={[
                  'rounded-sm border px-1 py-0.5 text-meta font-medium',
                  option.active
                    ? 'border-chat-success/40 bg-chat-success/10 text-chat-success-label'
                    : 'border-border text-muted-foreground',
                ]}>{option.value ?? strings.current()}</span
              >
            {/if}
          </span>
        </button>
      {/each}
      {#if menu.options.length === 0}
        <div class="px-2 py-2 text-small text-muted-foreground" role="status">
          {menu.kind === 'mention' ? (menu.provider?.notice ?? strings.nothingToAttach()) : strings.noCommandsFound()}
        </div>
      {/if}
    </div>
    {@const shown = menu.options[menu.active]}
    <div class="mt-1 flex items-center gap-3 border-t border-border px-2 py-1.5 text-small leading-4 text-muted-foreground">
      <div class="h-4 min-w-0 flex-1" data-fade {@attach clipFade}>{shown?.description ?? ''}</div>
      {#if shown?.keyHint}
        <span class="flex shrink-0 items-center gap-1.5"
          >{@render rendering.key({ ...shown.keyHint.chord, size: 'sm' })}{shown.keyHint.words}</span
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .completion-row {
    display: grid;
    grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) auto;
    align-items: center;
    gap: calc(var(--spacing) * 3);
    padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2);
    min-height: 28px;
    line-height: 18px;
  }
  .mention-label {
    color: var(--chat-skill);
  }
  @container (max-width: 28rem) {
    .completion-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .completion-description {
      display: none;
    }
  }
  @media (pointer: coarse) {
    .completion-row {
      min-height: 44px;
      line-height: 20px;
      padding-block: calc(var(--spacing) * 3);
    }
  }
</style>
