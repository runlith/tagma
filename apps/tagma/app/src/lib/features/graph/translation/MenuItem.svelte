<script lang="ts">
  import LanguagesIcon from '@lucide/svelte/icons/languages';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { languageName } from './languages.js';
  import { Translations } from './Translations.svelte.js';

  let { block, shown }: { block: string; shown: (language: string) => void } = $props();

  const translations = Translations.use();
  const notices = Notices.use();

  const entry = $derived(translations.entry(block));
  const words = $derived(
    entry === undefined ? 'Translate' : `${entry.standing ? 'Show in' : 'Translate to'} ${languageName(entry.language)}`,
  );
</script>

<DropdownMenu.Item
  icon={LanguagesIcon}
  onSelect={() =>
    void translations
      .press(block)
      .then(shown)
      .catch((error: unknown) => notices.refusal(error))}
>
  {words}
</DropdownMenu.Item>
