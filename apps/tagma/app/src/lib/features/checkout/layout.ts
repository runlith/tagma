export type ChangesLayout = 'split' | 'stacked';

export const CHANGES_LAYOUT = 'changes';

export const layoutOf = (mark: string | undefined): ChangesLayout => (mark === 'stacked' ? 'stacked' : 'split');
