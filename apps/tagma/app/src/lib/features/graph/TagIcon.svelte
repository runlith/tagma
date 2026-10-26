<script lang="ts">
  import Box from '@lucide/svelte/icons/box';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import ChefHat from '@lucide/svelte/icons/chef-hat';
  import FileText from '@lucide/svelte/icons/file-text';
  import GitPullRequestArrow from '@lucide/svelte/icons/git-pull-request-arrow';
  import Hash from '@lucide/svelte/icons/hash';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import MessageCircleWarning from '@lucide/svelte/icons/message-circle-warning';
  import Package from '@lucide/svelte/icons/package';
  import Shield from '@lucide/svelte/icons/shield';
  import SquareCheck from '@lucide/svelte/icons/square-check';
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import Table2 from '@lucide/svelte/icons/table-2';
  import Telescope from '@lucide/svelte/icons/telescope';
  import User from '@lucide/svelte/icons/user';

  const ICONS: Record<string, typeof Box> = {
    module: Package,
    spec: FileText,
    task: SquareCheck,
    rule: Shield,
    idea: Lightbulb,
    proposal: GitPullRequestArrow,
    view: Table2,
    reflection: MessageCircleWarning,
    research: Telescope,
    note: StickyNote,
    person: User,
    meeting: CalendarDays,
    recipe: ChefHat,
  };

  let { tag, class: className }: { tag: string | null; class?: string } = $props();

  const Icon = $derived(tag === null ? StickyNote : tag === 'project' ? Box : (ICONS[tag] ?? Hash));
</script>

<Icon class={className} />
