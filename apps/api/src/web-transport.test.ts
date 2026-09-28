import assert from "node:assert/strict";
import test from "node:test";
import type { RoomView } from "@abominations/shared";
import { CommandAckTracker } from "../../web/src/command-ack.js";
import { ConnectionLeaseState, type LeaseStorage } from "../../web/src/connection-lease.js";

class TestStorage implements LeaseStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const projectedRoom = (version: number) => ({ id: "room", code: "ABC123", status: "active", privacy: "private", version, state: {}, participants: [], events: [] }) as unknown as RoomView;

test("command ack resolves from a projection that arrived before the ack", () => {
  const tracker = new CommandAckTracker();
  const room = projectedRoom(12);
  tracker.register("early-update");
  assert.deepEqual(tracker.update(room), []);
  assert.equal(tracker.acknowledge("early-update", 12), room);
});

test("command ack waits for a lease-validated room projection at its accepted revision", () => {
  const tracker = new CommandAckTracker();
  tracker.register("later-update");
  assert.equal(tracker.acknowledge("later-update", 8), undefined);
  assert.deepEqual(tracker.update(projectedRoom(7)), []);
  assert.deepEqual(tracker.update(projectedRoom(8)), ["later-update"]);
});

test("pending client lease survives reload and recovers a lost ticket response", async () => {
  const storage = new TestStorage();
  storage.setItem("abominations-connection-id:ABC123", "lease-before-request");
  const firstPage = new ConnectionLeaseState(storage, () => "candidate-a");
  const candidate = firstPage.requested("ABC123");
  let issuedLease: string | null = null;
  await assert.rejects(() => firstPage.issue("ABC123", "ABC123:token", "ticket", async (ids) => {
    assert.equal(ids.expectedConnectionId, "lease-before-request");
    assert.equal(ids.requestedConnectionId, candidate);
    issuedLease = candidate;
    throw new TypeError("response was lost after ticket issuance");
  }), /response was lost/);

  const reloadedPage = new ConnectionLeaseState(storage, () => "should-not-be-used");
  assert.equal(reloadedPage.current("ABC123"), "lease-before-request");
  assert.equal(reloadedPage.requested("ABC123"), candidate);
  const recovered = await reloadedPage.issue("ABC123", "ABC123:token", "ticket", async (ids) => {
    assert.equal(ids.expectedConnectionId, "lease-before-request");
    assert.equal(ids.requestedConnectionId, issuedLease);
    return { ticket: "new-ticket", connectionId: issuedLease! };
  });
  assert.equal(recovered.connectionId, candidate);
  assert.equal(reloadedPage.current("ABC123"), candidate);
  assert.equal(storage.getItem("abominations-connection-id:ABC123:pending"), null);
});

test("a late acknowledgement cannot restore a lease cancelled by Leave", async () => {
  const storage = new TestStorage();
  const leases = new ConnectionLeaseState(storage, () => "pending-reconnect");
  leases.acknowledge("ABC123", "current-lease");
  const pending = leases.requested("ABC123");
  leases.cancel("ABC123", pending);
  assert.equal(leases.requested("ABC123"), pending, "the pending ID remains available to a reconnect request already scheduled");

  const response = await leases.issue("ABC123", "ABC123:token", "reconnect", async ({ expectedConnectionId, requestedConnectionId }) => {
    assert.equal(expectedConnectionId, "current-lease");
    assert.equal(requestedConnectionId, pending);
    return { room: projectedRoom(1), connectionId: requestedConnectionId };
  });
  assert.equal(response.connectionId, pending);
  assert.equal(leases.current("ABC123"), null);
  assert.equal(storage.getItem("abominations-connection-id:ABC123:pending"), null);
  assert.equal(storage.getItem("abominations-connection-id:ABC123:cancelled"), null);
});

test("clearing leases for a replacement session fences acknowledgements from the old token", async () => {
  const storage = new TestStorage();
  const leases = new ConnectionLeaseState(storage, (() => {
    let next = 0;
    return () => `lease-${++next}`;
  })());
  let releaseOldRequest!: () => void;
  let oldRequestStarted!: () => void;
  const oldStarted = new Promise<void>((resolve) => { oldRequestStarted = resolve; });
  const oldRequestGate = new Promise<void>((resolve) => { releaseOldRequest = resolve; });
  const oldRequest = leases.issue("ABC123", "ABC123:old-token", "reconnect", async ({ requestedConnectionId }) => {
    oldRequestStarted();
    await oldRequestGate;
    return { room: projectedRoom(1), connectionId: requestedConnectionId };
  });
  await oldStarted;

  leases.clear("ABC123");
  const newRequest = leases.issue("ABC123", "ABC123:new-token", "ticket", async ({ expectedConnectionId, requestedConnectionId }) => {
    assert.equal(expectedConnectionId, null);
    return { ticket: "new-session-ticket", connectionId: requestedConnectionId };
  });
  await newRequest;
  const newLease = leases.current("ABC123");
  assert.equal(newLease, "lease-2");

  releaseOldRequest();
  await oldRequest;
  assert.equal(leases.current("ABC123"), newLease, "old-token completion cannot overwrite the replacement session's lease");
});

test("separate tabs keep independent lease proposals and same-tab issuance is single-flight", async () => {
  let proposalNumber = 0;
  const firstTab = new ConnectionLeaseState(new TestStorage(), () => `tab-one-proposal-${++proposalNumber}`);
  const secondTab = new ConnectionLeaseState(new TestStorage(), () => "tab-two-proposal");
  firstTab.acknowledge("ABC123", "shared-old-lease");
  secondTab.acknowledge("ABC123", "shared-old-lease");
  assert.notEqual(firstTab.requested("ABC123"), secondTab.requested("ABC123"));

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const issueTicket = () => firstTab.issue("ABC123", "ABC123:token", "ticket", async ({ requestedConnectionId }) => {
    calls += 1;
    await firstGate;
    return { ticket: "ticket-one", connectionId: requestedConnectionId };
  });
  const first = issueTicket();
  const duplicate = issueTicket();
  const reconnect = firstTab.issue("ABC123", "ABC123:token", "reconnect", async ({ expectedConnectionId, requestedConnectionId }) => {
    assert.equal(expectedConnectionId, "tab-one-proposal-1");
    assert.equal(requestedConnectionId, "tab-one-proposal-2");
    return { room: projectedRoom(1), connectionId: requestedConnectionId };
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  releaseFirst();
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.deepEqual(duplicateResult, firstResult);
  assert.equal(calls, 1);
  await reconnect;
});
