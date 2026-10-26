export function surfaceOut() {
  return process.env.TAGMA_SURFACE_OUT?.trim() || 'build';
}
