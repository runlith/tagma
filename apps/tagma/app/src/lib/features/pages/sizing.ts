import { TOOL_VIEW_PX } from '@runlith/chat-ui/rowEstimate';
import type { Timeline } from '@tagma/server/artifacts/contract/wire/timeline';
import { tallest } from '../views/Frame.svelte';

export const motionWidth = (timeline: Timeline): string => `min(100%, ${Math.floor((tallest() * timeline.width) / timeline.height)}px)`;

export const previewHeight = (): number => Math.min(TOOL_VIEW_PX, tallest());
