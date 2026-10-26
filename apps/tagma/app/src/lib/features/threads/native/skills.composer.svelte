<script lang="ts">
  import type { AgentSkillAim } from '@tagma/server/threads/contract/wire/agentLibrary';
  import { skillInsertion, skillQuery, skillReference, skillReferences } from '@runlith/agent/skillReferences';
  import { rank } from '@runlith/search-text/match';
  import { Effect } from 'effect';
  import { untrack } from 'svelte';
  import type { ThreadBirth } from '../birth/ThreadBirth.svelte.js';
  import type { ChatHold } from '../ChatHold.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import type { SkillCatalog } from './SkillCatalog.svelte.js';
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';

  let {
    shown,
    chat,
    birth,
    skills,
    composer,
    contributor,
  }: {
    shown: ShownThread;
    chat: ChatHold;
    birth: ThreadBirth;
    skills: SkillCatalog;
    composer: ComposerContributions;
    contributor: string;
  } = $props();

  const session = $derived(chat.session);
  const phase = $derived(session?.runPhase?.phase ?? null);
  const aim = $derived<AgentSkillAim>(
    shown.id === null ? { kind: 'draft', type: birth.draftType ?? undefined } : { kind: 'thread', id: shown.id },
  );
  const options = $derived(
    skills.view.items.map((skill) => ({ id: skill.id, label: skillReference(skill.id), description: skill.description })),
  );
  const ids = $derived(skills.view.state === 'ready' ? new Set(skills.view.items.map((skill) => skill.id)) : null);

  $effect(() => {
    if (phase === 'calling')
      untrack(() => {
        void skills.refreshCurrent();
      });
  });

  $effect(() => {
    const wanted = aim;
    const runId = session?.activeRunId ?? null;
    untrack(() => skills.aim(wanted, runId));
  });

  $effect.pre(() =>
    composer.mention(contributor, {
      id: 'skills',
      prefix: '$',
      accent: true,
      get label() {
        return skills.view.label;
      },
      get notice() {
        return skills.view.notice;
      },
      options: (query) =>
        rank(options, query, (option) => ({ name: option.id, text: [option.description] })).map(({ item, hit }) => {
          const at = item.label.indexOf(item.id);
          return { ...item, hits: at < 0 ? [] : hit.positions.map((position) => position + at) };
        }),
      match: (text, from, to) => skillQuery(text, from, to),
      insertion: skillInsertion,
      marks: (text) => (ids === null ? [] : skillReferences(text).filter((reference) => ids.has(reference.id))),
      opened: () => Effect.promise(() => skills.view.onOpen()),
    }),
  );
</script>
