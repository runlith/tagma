<script lang="ts">
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Refusal } from '$lib/wire/refusal.js';
  import { HOLD } from './action.js';
  import { Dictation } from './Dictation.svelte.js';
  import { Targets } from './Targets.js';

  const dictation = Dictation.use();
  const targets = Targets.use();
  const notices = Notices.use();
  const keymap = Keymap.use();

  function press(send: boolean): void {
    if (dictation.phase === 'recording') {
      if (dictation.target !== null) dictation.press(dictation.target, send);
      return;
    }
    const target = targets.focused();
    if (target !== null) {
      dictation.press(target, send);
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

  function lift(send: boolean): void {
    if (dictation.phase !== 'idle') dictation.lift(send);
  }

  function escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || dictation.phase === 'idle') return;
    event.preventDefault();
    event.stopPropagation();
    dictation.cancel();
  }

  function blur(): void {
    if (dictation.phase === 'recording' && !dictation.latched) dictation.lift(false);
  }

  $effect(() => keymap.hold(HOLD, { press, lift }));

  $effect(() => {
    window.addEventListener('keydown', escape, { capture: true });
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', escape, { capture: true });
      window.removeEventListener('blur', blur);
    };
  });
</script>
