<script lang="ts">
  import Box from '@lucide/svelte/icons/box';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import FileText from '@lucide/svelte/icons/file-text';
  import GitPullRequestArrow from '@lucide/svelte/icons/git-pull-request-arrow';
  import Hash from '@lucide/svelte/icons/hash';
  import Library from '@lucide/svelte/icons/library';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import MessageCircleWarning from '@lucide/svelte/icons/message-circle-warning';
  import Package from '@lucide/svelte/icons/package';
  import Quote from '@lucide/svelte/icons/quote';
  import Shield from '@lucide/svelte/icons/shield';
  import Signpost from '@lucide/svelte/icons/signpost';
  import SquareCheck from '@lucide/svelte/icons/square-check';
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import Table2 from '@lucide/svelte/icons/table-2';
  import Tag from '@lucide/svelte/icons/tag';
  import Telescope from '@lucide/svelte/icons/telescope';
  import User from '@lucide/svelte/icons/user';
  import type { Component } from 'svelte';
  import ExplanationIcon from '$lib/features/graph/ExplanationIcon.svelte';

  const ICONS: Record<string, Component<{ class?: string }>> = {
    tag: Tag,
    catalog: Library,
    proposal: GitPullRequestArrow,
    reflection: MessageCircleWarning,
    view: Table2,
    module: Package,
    explanation: ExplanationIcon,
    spec: FileText,
    task: SquareCheck,
    rule: Shield,
    idea: Lightbulb,
    research: Telescope,
    decision: Signpost,
    person: User,
    meeting: CalendarDays,
    source: Quote,
  };

  let { tag, class: className }: { tag: string | null; class?: string } = $props();

  const Icon = $derived(tag === null ? StickyNote : tag === 'project' ? Box : (ICONS[tag] ?? Hash));
</script>

<Icon class={className} />
