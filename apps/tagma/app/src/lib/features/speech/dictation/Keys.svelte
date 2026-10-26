<script lang="ts">
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Refusal } from '$lib/wire/refusal.js';
  import { pressed } from './chord.js';
  import { Dictation } from './Dictation.svelte.js';
  import { Targets } from './Targets.js';

  const dictation = Dictation.use();
  const targets = Targets.use();
  const notices = Notices.use();

  function swallow(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function down(event: KeyboardEvent): void {
    if (event.key === 'Escape' && dictation.phase !== 'idle') {
      swallow(event);
      dictation.cancel();
      return;
    }
    if (!pressed(dictation.chord, event)) return;
    swallow(event);
    if (event.repeat) return;
    if (dictation.phase === 'recording') {
      if (dictation.target !== null) dictation.press(dictation.target, event.shiftKey);
      return;
    }
    const target = targets.focused();
    if (target !== null) {
      dictation.press(target, event.shiftKey);
      return;
    }
    notices.refusal(
      new Refusal({
        gate: false,
        code: 'no-dictation-target',
        reason: 'Dictation types into an agent field or a terminal, and none is focused or open.',
        unblock: ['Click into an agent field or a terminal, then hold the key again.'],
        words: { text: 'Click into an agent field or a terminal, then hold the key again to dictate.' },
      }),
    );
  }

  function up(event: KeyboardEvent): void {
    if (event.code !== dictation.chord.code || dictation.phase === 'idle') return;
    swallow(event);
    dictation.lift(event.shiftKey);
  }

  function blur(): void {
    if (dictation.phase === 'recording' && !dictation.latched) dictation.lift(false);
  }

  $effect(() => {
    window.addEventListener('keydown', down, { capture: true });
    window.addEventListener('keyup', up, { capture: true });
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, { capture: true });
      window.removeEventListener('keyup', up, { capture: true });
      window.removeEventListener('blur', blur);
    };
  });
</script>
