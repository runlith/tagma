export type AppFeed = {
  readonly labels: Readonly<Record<string, string>>;
  readonly kinds: Readonly<Record<string, string>>;
  readonly newest: string;
  readonly head: string;
  readonly opening: boolean;
  readonly jump: string;
};

export type Reach = { readonly requested: number };

export type AppBindings = {
  feedAppStream(chunks: number): Promise<AppFeed>;
  feedAppResize(width: number, height: number): Promise<void>;
  feedAppLeave(): Promise<void>;
  feedAppReturn(): Promise<void>;
  feedAppPaging(): Promise<Reach>;
};

export type AppGlobal = { feedApp?: AppFeed } & Partial<AppBindings>;
