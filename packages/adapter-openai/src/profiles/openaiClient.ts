import { arch, platform, release } from 'node:os';
import type { ProductIdentity } from '@runlith/llm/profiles/contract';

const host = `${platform()} ${release()}; ${arch()}`;

export function openaiUserAgent(product: ProductIdentity): string {
  return `${product.client.name}/${product.client.version} (${host})`;
}

export function openaiTurnHeaders(product: ProductIdentity, sessionId: string): Record<string, string> {
  return {
    originator: product.client.name,
    'User-Agent': openaiUserAgent(product),
    'session-id': sessionId,
  };
}
