import { Context } from 'effect';
import type { RootEnding } from '../../../executions/contract/service/rootExecutions.js';

export class RootEndings extends Context.Service<RootEndings, RootEnding>()('tagma/worktrees/RootEndings') {}
