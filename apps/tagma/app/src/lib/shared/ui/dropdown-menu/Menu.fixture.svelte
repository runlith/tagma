<script lang="ts">
  import Circle from '@lucide/svelte/icons/circle';
  import * as DropdownMenu from './index.js';

  let {
    picked,
    aside = $bindable(null),
    filter = false,
  }: { picked: (name: string) => void; aside?: string | null; filter?: boolean } = $props();

  let checked = $state(false);
  let tone = $state('plain');
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger data-trigger>Open</DropdownMenu.Trigger>
  <DropdownMenu.Content>
    {#if filter}<input data-filter data-runlith-autofocus />{/if}
    <DropdownMenu.Item icon={Circle} onSelect={() => picked('alpha')}>Alpha</DropdownMenu.Item>
    <DropdownMenu.Item icon={Circle} closeOnSelect={false} onSelect={() => picked('stay')}>Stay</DropdownMenu.Item>
    <DropdownMenu.Group data-group>
      <DropdownMenu.GroupHeading>Format</DropdownMenu.GroupHeading>
      <DropdownMenu.CheckboxItem bind:checked>Wrap</DropdownMenu.CheckboxItem>
    </DropdownMenu.Group>
    <DropdownMenu.RadioGroup bind:value={tone}>
      <DropdownMenu.RadioItem value="plain">Plain</DropdownMenu.RadioItem>
      <DropdownMenu.RadioItem value="bold">Bold</DropdownMenu.RadioItem>
    </DropdownMenu.RadioGroup>
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={Circle}>Spacing</DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent data-spacing>
        <DropdownMenu.Item icon={Circle} onSelect={() => picked('tight')}>Tight</DropdownMenu.Item>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={Circle}>More</DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent data-sub>
        <DropdownMenu.Item icon={Circle} onSelect={() => picked('deep')}>Deep</DropdownMenu.Item>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Item icon={Circle} onSelect={() => picked('omega')}>Omega</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<DropdownMenu.Root bind:open={() => aside !== null, (next) => !next && (aside = null)}>
  <DropdownMenu.Content anchor={{ x: 40, y: 40 }}>
    <DropdownMenu.Item icon={Circle} onSelect={() => picked(aside ?? 'gone')}>Aside</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<output data-checked={checked} data-tone={tone}></output>
