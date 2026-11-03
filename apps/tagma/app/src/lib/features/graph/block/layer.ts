import { Layer } from '@runlith/layer/Layer';
import { LinksPlacement } from './LinksPlacement.svelte.js';
import { BlockSections } from './sections.js';

export const BlockLayer = Layer.mergeAll(LinksPlacement, BlockSections);
