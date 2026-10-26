<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import Card from './Card.svelte';
  import { SpeechRepo } from './Repo.js';

  const notices = Notices.use();
  const speech = SpeechRepo.use();

  let text = $state('');
  let busy = $state(false);
  let voiced = $state<string | null>(null);

  async function say(): Promise<void> {
    const phrase = text.trim();
    if (phrase === '') return;
    busy = true;
    try {
      const answer = await speech.speak.run({ text: phrase }, { throwOnError: true });
      voiced = answer === undefined ? null : `${answer.provider} · ${answer.model} · ${answer.voice}`;
    } catch (error: unknown) {
      voiced = null;
      notices.refusal(error);
    } finally {
      busy = false;
    }
  }

  async function silence(): Promise<void> {
    try {
      await speech.stopSpeaking.run(undefined, { throwOnError: true });
      voiced = null;
    } catch (error: unknown) {
      notices.refusal(error);
    }
  }
</script>

<Card title="Speak" fact={voiced ?? 'Hear a phrase with the default voice'}>
  <div class="flex items-center gap-2 py-3">
    <Input placeholder="Type a phrase…" bind:value={text} onkeydown={(event) => event.key === 'Enter' && void say()} />
    <Button size="sm" disabled={busy || text.trim() === ''} onclick={() => void say()}>Speak</Button>
    <Button variant="outline" size="sm" onclick={() => void silence()}>Stop</Button>
  </div>
</Card>
