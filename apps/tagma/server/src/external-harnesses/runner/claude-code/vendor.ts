export const WEB_SEARCH = { wire: 'WebSearch', tagma: 'websearch' } as const;
export const WEB_FETCH = { wire: 'WebFetch', tagma: 'webfetch' } as const;

export const VENDOR_TOOLS = [WEB_SEARCH, WEB_FETCH] as const;

export const nativeNameOf = (wire: string): string | undefined => VENDOR_TOOLS.find((tool) => tool.wire === wire)?.tagma;

export const wireNameOf = (tagma: string): string | undefined => VENDOR_TOOLS.find((tool) => tool.tagma === tagma)?.wire;
