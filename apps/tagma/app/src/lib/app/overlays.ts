import { Layer } from '@runlith/layer/Layer';
import { Dialogs } from '@runlith/primitives/DialogRegistry.svelte';
import { Launchers } from '@runlith/primitives/Launchers.svelte';
import { Overlay } from '@runlith/primitives/Overlay.svelte';

export const Overlays = Layer.mergeAll(Overlay, Dialogs, Launchers);
