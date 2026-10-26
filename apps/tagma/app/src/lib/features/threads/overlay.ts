import { Overlay } from '@runlith/primitives/Overlay.svelte';

export type AgentLibraryProps = {
  projectId: number;
  agentId?: string;
  threadId?: string;
  onSaved?: () => void;
};
export const AgentLibraryOverlay = Overlay.define<AgentLibraryProps>()('tagma/agent-library', { as: 'dialog' });
