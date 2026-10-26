export type ChatAct = { readonly label: string; readonly run: () => void };

export type ChatTold = {
  readonly note?: string | undefined;
  readonly details?: readonly string[] | undefined;
  readonly code?: string | undefined;
  readonly act?: ChatAct | undefined;
};

export type ChatNotice = {
  message: string;
  tone: 'error' | 'success';
  told?: ChatTold | undefined;
};
