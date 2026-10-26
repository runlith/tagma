<script lang="ts">
  import type { I18n } from './I18n.svelte.js';

  type Props = {
    i18n: I18n;
  };

  const { i18n }: Props = $props();
</script>

<div data-testid="locale">{i18n.locale}</div>
<div data-testid="greet">{i18n.t('greet')}</div>

<button type="button" data-testid="set-en" onclick={() => (i18n.locale = 'en')}> set-en </button>
<button type="button" data-testid="set-ru" onclick={() => (i18n.locale = 'ru')}> set-ru </button>

<button type="button" data-testid="change-en" onclick={() => i18n.changeLocale('en')}> change-en </button>
<button type="button" data-testid="change-ru" onclick={() => i18n.changeLocale('ru')}> change-ru </button>

<button type="button" data-testid="en-disabled" disabled={i18n.locale === 'en'}>EN</button>
<button type="button" data-testid="ru-disabled" disabled={i18n.locale === 'ru'}>RU</button>
