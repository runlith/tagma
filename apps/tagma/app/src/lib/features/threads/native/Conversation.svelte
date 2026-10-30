<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { tooltip } from '@runlith/primitives/tooltip.svelte';
  import type { ChatButton, ChatChord, ChatCodeBody, ChatKey, ChatMarkdownBody, ChatTip } from '@runlith/chat-ui/renderers';
  import type { ChatAttachment } from '@runlith/chat-ui/entries';
  import ChatSurface from '@runlith/chat-ui/ChatSurface.svelte';
  import { createEntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
  import { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import { FeedMemory } from '@runlith/chat-ui/FeedMemory';
  import { PromptHandle } from '@runlith/chat-ui/PromptHandle.svelte';
  import { copyPicture } from '@runlith/chat-ui/pictures';
  import { provideChatStrings } from '@runlith/chat-ui/strings';
  import { highlightLinesOffThread } from '@runlith/highlight/offThread';
  import { Host } from '@runlith/layer/Host';
  import { overlayLayers } from '@runlith/primitives/OverlayLayers.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { FileSaver } from '$lib/shared/FileSaver.js';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
  import CodeBody from '$lib/features/graph/CodeBody.svelte';
  import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
  import { SettingChips } from '$lib/features/settings/chips/SettingChips.svelte.js';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import type { ChatLink } from '@runlith/chat-ui/surface';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { fileLink } from '$lib/features/checkout/links.js';
  import { PathRoads } from '$lib/features/checkout/PathRoads.js';
  import type { Link, LinkFrom } from '$lib/features/opening/Link.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import type { PathRoad } from '$lib/features/opening/PathLinks.js';
  import { threadLink } from '$lib/features/presence/link.js';
  import { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import BlockRefText from '../BlockRefText.svelte';
  import { CallActivity } from '../CallActivity.svelte.js';
  import HarnessTerminal from '../external/Terminal.svelte';
  import { ThreadOnScreen } from '../OnScreen.svelte.js';
  import { ThreadList } from '../List.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Door } from '$lib/wire/Door.js';
  import { Refusal } from '$lib/wire/refusal.js';
  import type { ThreadSlot } from '../ThreadSlot.svelte.js';
  import { ThreadPlace } from '../thread/ThreadPlace.svelte.js';
  import ChatButtonView from './ChatButton.svelte';
  import type { SlotOwners } from './contribution.js';
  import Contributions from './Contributions.svelte';
  import { declared } from './declared.js';
  import { imageFileName } from './imageFile.js';
  import ImageMenu, { type ImageAim } from './ImageMenu.svelte';
  import { ThreadPreferences } from './preferences.js';
  import { RenderingPorts } from './RenderingPorts.svelte.js';
  import { nativeStrings } from './strings.js';
  import { TranscriptReading } from './TranscriptReading.svelte.js';

  let { host, lead, sheets = false }: { host: ThreadSlot; lead?: Snippet; sheets?: boolean } = $props();

  provideChatStrings(nativeStrings());

  const roads = PathRoads.use();

  const standing = $derived(host.thread?.get(ThreadPlace).standing ?? null);

  const pathFrom = $derived(standing?.kind === 'row' ? (host.places.folderOf(standing.row) ?? undefined) : undefined);

  let chat = $state<{ openImage(image: ChatAttachment): void } | undefined>();

  const notices = Notices.use();
  const opening = Opening.use();
  const here = App.current();

  let imageAim = $state.raw<ImageAim | null>(null);
  const door = Door.use();
  const files = FileSaver.use();

  const from = $derived<LinkFrom>({ thread: host.activeId ?? undefined, project: host.projectId, folder: pathFrom });

  const picture = (shown: { readonly url: string; readonly name: string; readonly mediaType: string }): void =>
    chat?.openImage({ url: shown.url, filename: shown.name, mime: shown.mediaType });

  const fileOf = (path: string, line?: number | null, column?: number | null): Link =>
    fileLink({ path, line: line ?? null, column: column ?? null, picture }, from);

  const paths = $derived<PathRoad>(roads.road(from, { picture }));

  const linkOf = (target: ChatLink): Link =>
    target.kind === 'file'
      ? fileOf(target.path, target.line)
      : threadLink({ threadId: target.threadId, projectId: target.projectId ?? list.homeOf(target.threadId) }, from);

  const keymap = Keymap.use();

  function spelled(chord: ChatChord): string {
    const base = chord.mod === true ? keymap.mod(chord.code) : keymap.bare(chord.code);
    return keymap.spell({ ...base, alt: chord.alt === true, shift: chord.shift === true });
  }

  const tip = (shown: () => ChatTip): Attachment<HTMLElement> =>
    tooltip.trigger(() => {
      const { text, chord } = shown();
      return { text, keys: chord === undefined ? null : spelled(chord) };
    });
  const onScreen = ThreadOnScreen.use();
  const list = ThreadList.use();
  const stored = ThreadPreferences.use();
  const blockTitles = BlockTitles.use();
  const commitLinks = CommitLinks.use();
  const settingsRepo = SettingsRepo.use();
  const settingChips = $derived(new SettingChips(settingsRepo, host.projectId));
  const names = ThreadNames.use();
  const commandActivity = CommandActivity.use();
  const callActivity = CallActivity.use();

  const harnessThread = $derived(host.surface.terminal);
  const commands = $derived(host.chat.commands);
  const visible = $derived(onScreen.host === host);
  const focusKey = $derived(visible ? `${host.activeId ?? 'draft'}:${onScreen.activation(host)}` : '');

  const prompt = new PromptHandle();
  $effect(() => {
    if (focusKey !== '') untrack(() => prompt.focus());
  });

  let element = $state<HTMLElement | null>(null);

  const surface = {
    get sheets() {
      return sheets;
    },
    get lead() {
      return lead;
    },
    prompt,
    get element() {
      return element;
    },
    get visible() {
      return visible;
    },
  };

  const kinds = createEntryKinds();
  const composer = new ComposerContributions();
  const regions = new FeedRegions();
  const ports = new RenderingPorts();
  const memory = new FeedMemory(untrack(() => stored.surface.disclosure.read()));
  const owners = $derived<SlotOwners>({
    shown: host.shown,
    chat: host.chat,
    draft: host.draft,
    feeds: host.feeds,
    skills: host.skills,
    birth: host.birth,
    places: host.places,
    panel: host.panel,
    views: host.views,
    writes: host.writes,
  });
  const transcript = $derived(new TranscriptReading(host.shown, host.chat, names, commandActivity, callActivity));

  const rendering = {
    regions,
    get context() {
      return ports.context;
    },
    get rewind() {
      return ports.rewind;
    },
    markdown,
    code,
    button,
    key,
    tip,
    userText,
    lineText,
    threadName: (threadId: string, projectId?: number) =>
      names.of(threadId, projectId === undefined ? undefined : String(projectId))?.label.trim() || null,
    copyText,
    copyImage,
    saveImage,
    highlight: highlightLinesOffThread,
    touch: Host.use().touch,
    layered: (surface: Element) => {
      const top = overlayLayers.top();
      return top !== undefined && !top.owns(surface);
    },
  };

  const navigation = {
    get keyboard() {
      return visible;
    },
    files: true,
    link: (target: ChatLink) => linkTarget(opening, () => linkOf(target), here),
    linkMenu: (target: ChatLink, at: { readonly x: number; readonly y: number }) => opening.menu(linkOf(target), at, here),
    imageMenu: (image: ChatAttachment, at: { readonly x: number; readonly y: number }, layer: HTMLElement | null) =>
      (imageAim = { ...at, image, layer }),
    entryAddress: (entryId: string) => (host.activeId ? `tagma thread ${host.activeId} --at ${entryId}` : null),
  };

  async function copyImage(image: ChatAttachment): Promise<boolean> {
    try {
      await copyPicture(() => door.bytes(image.url));
      return true;
    } catch (error) {
      if (error instanceof Refusal) notices.refusal(error);
      else notices.fault('Couldn’t copy image', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function saveImage(image: ChatAttachment): Promise<void> {
    try {
      const bytes = await door.bytes(image.url);
      files.save(bytes, imageFileName(image, bytes.type));
    } catch (error) {
      if (error instanceof Refusal) notices.refusal(error);
      else notices.fault('Couldn’t save image', error instanceof Error ? error.message : String(error));
    }
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
</script>

{#snippet markdown(body: ChatMarkdownBody)}
  <MarkdownBody
    text={body.text}
    size={body.size ?? 'body'}
    class={body.class ?? ''}
    cacheKey={body.cacheKey}
    streaming={body.streaming ?? false}
    refs={blockTitles}
    commits={commitLinks}
    settings={settingChips}
    threadOf={(id) => names.of(id)}
    {paths}
    {from}
  />
{/snippet}

{#snippet code(body: ChatCodeBody)}
  <CodeBody text={body.text} language={body.language} firstLine={body.firstLine} />
{/snippet}

{#snippet userText(text: string)}
  <BlockRefText {text} {paths} {from} />
{/snippet}

{#snippet lineText(text: string)}<BlockRefText {text} plain />{/snippet}

{#snippet button(control: ChatButton)}
  <ChatButtonView {control} />
{/snippet}

{#snippet key(shown: ChatKey)}<Kbd chord={spelled(shown)} size={shown.size} />{/snippet}

<Contributions {owners} {surface} {composer} {kinds} {regions} rendering={ports} {transcript} {declared} />

<ImageMenu
  aim={imageAim}
  onCopy={(image) => void copyImage(image)}
  onSave={(image) => void saveImage(image)}
  onClose={() => (imageAim = null)}
/>

{#if harnessThread !== null}
  <HarnessTerminal
    threadId={harnessThread.threadId}
    projectId={harnessThread.projectId}
    execution={harnessThread.execution}
    harness={harnessThread.harness}
    attempt={host.harnessOpen}
  />
{:else}
  <div class="contents" bind:this={element}>
    <ChatSurface
      bind:this={chat}
      turns={commands}
      {kinds}
      {composer}
      {memory}
      {rendering}
      {navigation}
      preferences={stored.surface}
      handle={prompt}
    />
  </div>
{/if}
