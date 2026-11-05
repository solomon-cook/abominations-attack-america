export interface RoomSnapshotVersion {
  code: string;
  version: number;
}

/** Keep delayed reads or socket messages from moving a room back to an older version. */
export function preferRoomSnapshot<T extends RoomSnapshotVersion>(current: T | null, incoming: T): T {
  if (current && current.code === incoming.code && incoming.version < current.version) return current;
  return incoming;
}
