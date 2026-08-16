export interface ExistingUserIdentity {
  id: string;
  username: string;
}

export interface IncomingUserIdentity {
  id?: string;
  username?: string;
  [key: string]: unknown;
}

export function getUsersToCreate<T extends IncomingUserIdentity>(
  existingUsers: ExistingUserIdentity[],
  incomingUsers: T[],
): T[] {
  const existingIds = new Set(existingUsers.map(user => user.id));
  const existingUsernames = new Set(existingUsers.map(user => user.username));

  return incomingUsers.filter(user => {
    if (user.id && existingIds.has(user.id)) return false;
    if (user.username && existingUsernames.has(user.username)) return false;
    return true;
  });
}

export function isDuplicateUserError(error: unknown): boolean {
  const candidate = error as { errno?: number; code?: string } | undefined;
  return candidate?.errno === 1062 || candidate?.code === 'ER_DUP_ENTRY';
}
