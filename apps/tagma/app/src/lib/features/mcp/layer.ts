import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { McpFeed } from './Feed.js';
import { McpRepo } from './Repo.js';
import { sections } from './settings.js';

export const McpLayer = Layer.mergeAll(SettingSections.contribute('mcp', ...sections), McpRepo, McpFeed);
