import { CHECKOUT, type SurfacesModule } from '$lib/features/workspace/surface.js';
import CheckoutIcon from './CheckoutIcon.svelte';

export const surfaces: SurfacesModule['surfaces'] = [
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
