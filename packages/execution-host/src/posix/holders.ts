export type FileHolders =
  | { readonly _tag: 'Holders'; readonly pids: readonly number[] }
  | { readonly _tag: 'Unread'; readonly detail: string };
