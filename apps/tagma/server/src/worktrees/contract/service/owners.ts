import { Context } from 'effect';
import type { WorktreeAssembly } from '../../assembly.js';

export class WorktreeOwners extends Context.Service<WorktreeOwners, WorktreeAssembly>()('tagma/worktrees/WorktreeOwners') {}
