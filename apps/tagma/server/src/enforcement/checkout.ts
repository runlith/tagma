export type Checkout = { readonly projectId: number; readonly root: string };

export const checkoutKey = (checkout: { readonly projectId: number; readonly root: string | null }): string =>
  `${checkout.projectId}\0${checkout.root ?? ''}`;
