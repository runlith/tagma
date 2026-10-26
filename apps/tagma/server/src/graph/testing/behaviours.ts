import { BEHAVIOURS } from '../contract/service/behaviours.js';
import { graph as declaration } from '../contract/wire/module.js';
import { graph } from '../graph.js';
import { registerBehaviours } from '../vocabulary/behaviours.js';

const operations = new Set(Object.keys((await declaration.operations()).declarations));

export const GRAPH_BEHAVIOURS = registerBehaviours(BEHAVIOURS.collect([graph]), operations);
