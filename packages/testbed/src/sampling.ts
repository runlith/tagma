const hashOf = (text: string): number => {
  let hash = 2166136261;
  for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 16777619);
  return hash >>> 0;
};

export const REAL_VARIANT_ONE_IN = 4;

export const sampledShare = (seed: string, salt: string): boolean => hashOf(`${seed}:${salt}`) % REAL_VARIANT_ONE_IN === 0;
