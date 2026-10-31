import { CHECKOUT, type SurfaceDeclaration } from '$lib/features/workspace/surface.js';
import CheckoutIcon from './CheckoutIcon.svelte';

export const surfaces: readonly SurfaceDeclaration[] = [
  {
    surface: CHECKOUT,
    route: 'checkout',
    label: 'Checkout',
    icon: CheckoutIcon,
    rail: 20,
    pinned: true,
    stands: 'graph',
    remembers: true,
  },
];
