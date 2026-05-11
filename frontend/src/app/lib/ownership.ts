export function canonicalOwnerId(id?: string | null): string {
  if (!id) return "";
  const decoded = decodeURIComponent(id);
  const [, recordKey] = decoded.split(":", 2);
  return recordKey || decoded;
}

export function isSameOwner(ownerId?: string | null, userId?: string | null): boolean {
  const owner = canonicalOwnerId(ownerId);
  const user = canonicalOwnerId(userId);
  return !!owner && !!user && owner === user;
}
