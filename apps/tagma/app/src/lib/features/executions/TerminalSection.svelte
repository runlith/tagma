<script lang="ts">
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import { pick, rest, type SectionProps } from '$lib/features/settings/section.js';

  let { catalog, scope, project }: SectionProps = $props();

  const TYPEFACE = [
    'terminal.fontFamily',
    'terminal.fontSize',
    'terminal.fontWeight',
    'terminal.fontWeightBold',
    'terminal.lineHeight',
    'terminal.ligatures',
  ];
  const THEME = [
    'terminal.themeDark',
    'terminal.themeLight',
    'terminal.useSeparateLightTheme',
    'terminal.colorOverrides',
    'terminal.backgroundOpacity',
    'terminal.cursorStyle',
    'terminal.cursorBlink',
    'terminal.cursorOpacity',
  ];
  const PANE = [
    'terminal.paddingX',
    'terminal.paddingY',
    'terminal.dividerThicknessPx',
    'terminal.dividerColorDark',
    'terminal.dividerColorLight',
    'terminal.inactivePaneOpacity',
    'terminal.activePaneOpacity',
    'terminal.opacityTransitionMs',
  ];
  const USE = [
    'terminal.scrollbackRows',
    'terminal.scrollSensitivity',
    'terminal.fastScrollSensitivity',
    'terminal.tuiScrollSensitivity',
    'terminal.focusFollowsMouse',
    'terminal.mouseHideWhileTyping',
    'terminal.macOptionAsAlt',
    'terminal.gpuAcceleration',
    'terminal.clipboardOnSelect',
    'terminal.rightClickToPaste',
    'terminal.allowOsc52Clipboard',
    'terminal.shortcutPolicy',
    'terminal.wordSeparator',
    'terminal.skipCloseConfirm',
  ];

  const entries = $derived(catalog.entriesOf('terminal'));
  const claimed = [...TYPEFACE, ...THEME, ...PANE, ...USE];
</script>

<div class="grid">
  <KeyCard title="Typeface" entries={pick(entries, TYPEFACE)} {catalog} {scope} {project} />
  <KeyCard title="Theme" entries={pick(entries, THEME)} {catalog} {scope} {project} />
  <KeyCard title="Pane" entries={pick(entries, PANE)} {catalog} {scope} {project} />
  <KeyCard title="Use" entries={pick(entries, USE)} {catalog} {scope} {project} />
  {#if rest(entries, claimed).length > 0}
    <KeyCard title="More" entries={rest(entries, claimed)} {catalog} {scope} {project} />
  {/if}
</div>
