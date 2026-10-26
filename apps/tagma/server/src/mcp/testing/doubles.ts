import { mcpServersLayer as mcpServersLayerFn } from '../serverPool.js';

export const mcpServersLayer = (...input: Parameters<typeof mcpServersLayerFn>) => mcpServersLayerFn(...input);
