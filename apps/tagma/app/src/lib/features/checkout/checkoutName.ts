export const checkoutName = (checkout: { readonly branch: string | null; readonly root: string }): string =>
  checkout.branch ?? checkout.root.slice(checkout.root.lastIndexOf('/') + 1);

export const abroad = (places: readonly { readonly projectId: number | null }[], home: number): boolean =>
  places.some((place) => place.projectId !== home);
