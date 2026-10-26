export function threadAgentSubject(ownerId: string, address: string): string {
  return `agent://${ownerId}/${address}`;
}

export function spawnTypeSubject(ownerId: string, typeId: string): string {
  return `spawn://${ownerId}/${typeId}`;
}
