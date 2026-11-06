import type { PluginPoints } from '../contract/service/points.js';
import { makePoints } from '../points.js';

export const pluginPoints = (): PluginPoints['Service'] => makePoints();
