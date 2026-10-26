import { Service } from '@runlith/layer/key';
import type { PaneContent, SidePane } from '$lib/shared/panes/pane.js';
import type { LinkFrom } from './Link.js';

export type BesideAsk = {
  readonly content: PaneContent;
  readonly from?: LinkFrom | undefined;
  readonly standing?: ((tabs: readonly SidePane[], active: string | null) => SidePane | undefined) | undefined;
};

export type BesideSeek = {
  readonly kind: string;
  readonly from?: LinkFrom | undefined;
  readonly match: (tab: SidePane) => boolean;
};

export type BesideSought = 'shown' | 'absent' | 'nowhere';

export interface BesidePort {
  show(ask: BesideAsk): boolean;
  seek(ask: BesideSeek): BesideSought;
}

export class Beside extends Service<BesidePort>()('Beside', { tier: 'app' }) {}
