import type { ViewTools } from '@runlith/tagma/plugin';
import type { ClientMembers, ViewToolCalls } from './client.svelte.js';
import { PluginMount } from './PluginMount.svelte.js';

export type TagmaView<Plugin = unknown> = ClientMembers & {
  readonly tools: unknown extends Plugin ? ViewToolCalls : ViewTools<Plugin>;
  readonly [capability: string]: unknown;
};

export const useTagma = <Plugin = unknown>(): TagmaView<Plugin> => PluginMount.use().client as unknown as TagmaView<Plugin>;

export { type ComposerFace, TagmaRefused, type ToolFace } from '@runlith/tagma/plugin';
export { default as Thread } from './Thread.svelte';
export type { Reading, ThreadReading, ViewOpening, ViewStorage } from './client.svelte.js';
export type { Transcript } from './transcriptReading.svelte.js';
export { default as Frame } from '$lib/shared/frame/Frame.svelte';
export { Button } from '$lib/shared/ui/button/index.js';
export { Input } from '$lib/shared/ui/input/index.js';
export { Textarea } from '$lib/shared/ui/textarea/index.js';
export { default as Tooltip } from '$lib/shared/ui/tooltip/Tooltip.svelte';
export { default as Kbd } from '$lib/shared/ui/kbd/Kbd.svelte';
export { default as FadeText } from '$lib/shared/FadeText.svelte';
export { default as PathText } from '$lib/shared/PathText.svelte';
export { default as Glyph } from '$lib/shared/ui/Glyph.svelte';
export { default as TileMeter } from '$lib/shared/ui/TileMeter.svelte';
export * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
export * as Dialog from '$lib/shared/ui/dialog/index.js';
