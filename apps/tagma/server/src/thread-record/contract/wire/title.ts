export const DEFAULT_TITLE = 'New thread';

export const TITLE_PROVENANCES = ['random', 'generated', 'manual', 'agent', 'harness'] as const;
export type TitleProvenance = (typeof TITLE_PROVENANCES)[number];

export type TitleNaming = {
  readonly outcome: 'written' | 'same-text' | 'superseded';
  readonly before: ThreadTitle | null;
  readonly after: ThreadTitle | null;
};

export type ThreadTitle = {
  readonly title: string;
  readonly origin: TitleProvenance;
  readonly revision: number;
};
