import type { RoomView } from "@abominations/shared";

/** Correlates an acknowledgement with the later lease-validated room broadcast. */
export class CommandAckTracker {
  private latestRoom?: RoomView;
  private readonly acceptedVersions = new Map<string, number>();

  register(actionId: string): void {
    this.acceptedVersions.delete(actionId);
  }

  acknowledge(actionId: string, version: number): RoomView | undefined {
    this.acceptedVersions.set(actionId, version);
    if (this.latestRoom && this.latestRoom.version >= version) {
      this.acceptedVersions.delete(actionId);
      return this.latestRoom;
    }
    return undefined;
  }

  update(room: RoomView): string[] {
    this.latestRoom = room;
    const resolved: string[] = [];
    for (const [actionId, version] of this.acceptedVersions) {
      if (room.version >= version) {
        this.acceptedVersions.delete(actionId);
        resolved.push(actionId);
      }
    }
    return resolved;
  }

  forget(actionId: string): void {
    this.acceptedVersions.delete(actionId);
  }
}
