import { Context } from 'effect';
import type { WorkspaceImports } from '@runlith/agent-tools/WorkspaceImports';
import type { ToolFactoryOptions } from '@runlith/agent-tools/workspace';

export const GuestFileReader = Context.Reference<WorkspaceImports | null>('tagma/sandbox/GuestFileReader', {
  defaultValue: () => null,
});

export const ImportDestination = Context.Reference<ToolFactoryOptions | null>('tagma/sandbox/ImportDestination', {
  defaultValue: () => null,
});
