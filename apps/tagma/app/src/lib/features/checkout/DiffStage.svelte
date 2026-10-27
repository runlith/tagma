<script lang="ts">
  import type { CheckoutLines, ComparedPath } from '@tagma/server/workspace/contract/wire/checkout';
  import type { ThreadEntry } from '@tagma/server/change-record/contract/wire/threadChanges';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { shownOrder, stepOf, weightMark } from './changeItem.js';
  import { CheckoutRepo } from './Repo.js';
  import DiffTab from './DiffTab.svelte';
  import { groupedIn } from './grouping.js';
  import { fileLink } from './links.js';
  import type { OpenedFile } from './opened.js';
  import { entriesIn, ThreadChanges } from './ThreadChanges.svelte.js';

  let { file }: { file: OpenedFile } = $props();

  const changes = ThreadChanges.use();
  const repo = CheckoutRepo.use();
  const marks = ReaderMarks.use();
  const opening = Opening.use();

  const grouped = $derived(groupedIn(marks));

  const standing = $derived(file.commit === null && file.lens === undefined ? changes.checkoutOf(file.rootId) : null);

  const working = $derived(standing?.entries.find((one) => one.path === file.path) ?? null);

  const listed = $derived.by<readonly ThreadEntry[] | null>(() =>
    standing === null || working === null ? null : entriesIn(standing, working.section),
  );

  const committed = $derived.by<readonly ComparedPath[] | null>(() => {
    if (file.commit === null || file.lens !== undefined) return null;
    return (
      repo.commitReading.key({ projectId: file.projectId, rootId: file.rootId, commit: file.commit, thread: changes.threadId }).data
        ?.files ?? null
    );
  });

  const walk = $derived.by<readonly { readonly path: string; readonly lines?: CheckoutLines }[] | null>(() => {
    const within: readonly { readonly path: string; readonly lines?: CheckoutLines }[] | null = listed ?? committed;
    return within === null || !within.some((one) => one.path === file.path) ? null : shownOrder(within, grouped);
  });

  const mark = $derived.by<string | undefined>(() => {
    if (working === null) return undefined;
    if (working.section === 'unproven') return `${working.git ?? ''}:unproven`;
    const git = working.section === 'uncommitted' ? (working.git ?? '') : 'ignored';
    return `${git}:${working.writing}:${weightMark(working.lines)}`;
  });

  const lines = $derived.by<CheckoutLines | null>(() => {
    if (file.commit !== null) {
      const files =
        file.lens === undefined
          ? committed
          : (repo.commitReading.key({ projectId: file.projectId, rootId: file.rootId, commit: file.commit }).data?.files ?? null);
      return files?.find((one) => one.path === file.path)?.lines ?? null;
    }
    if (file.lens !== undefined) return file.lines ?? null;
    return working === null || working.section === 'unproven' ? null : working.lines;
  });

  $effect(() => {
    if (file.lens !== undefined || file.commit !== null || !changes.known || working !== null) return;
    changes.open = null;
  });

  function step(direction: 1 | -1): void {
    if (walk === null) return;
    const next = stepOf(walk, file.path, direction);
    if (next !== null) changes.open = { projectId: file.projectId, rootId: file.rootId, path: next.path, commit: file.commit };
  }
</script>

{#if file.lens !== undefined}
  {@const lens = file.lens}
  <DiffTab
    projectId={file.projectId}
    rootId={file.rootId}
    path={file.path}
    commit={file.commit ?? lens.range?.head ?? null}
    range={file.commit === null ? lens.range : null}
    {lines}
    onClose={() => (changes.open = null)}
    onCommit={(commit) => (changes.open = { projectId: file.projectId, rootId: file.rootId, path: file.path, commit, lens })}
  />
{:else}
  <DiffTab
    projectId={file.projectId}
    rootId={file.rootId}
    path={file.path}
    commit={file.commit}
    {lines}
    mine={changes.threadId}
    {mark}
    onClose={() => (changes.open = null)}
    onStep={walk === null ? undefined : step}
    onCommit={(commit) => (changes.open = { projectId: file.projectId, rootId: file.rootId, path: file.path, commit })}
    onOpenFile={(line) =>
      void opening.open(
        fileLink({ path: file.path, line, root: file.rootId }, { project: file.projectId, thread: changes.threadId }),
        'beside',
      )}
  />
{/if}
