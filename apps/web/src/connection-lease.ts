export interface LeaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LeaseRequestIds {
  expectedConnectionId: string | null;
  requestedConnectionId: string;
}

/** Persists a pending lease ID so an HTTP retry or page reload can recover its acknowledgement. */
export class ConnectionLeaseState {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly generations = new Map<string, number>();

  constructor(private readonly storage: LeaseStorage, private readonly createId: () => string) {}

  current(code: string): string | null {
    return this.storage.getItem(this.currentKey(code));
  }

  requested(code: string): string {
    const key = this.pendingKey(code);
    const existing = this.storage.getItem(key);
    if (existing) return existing;
    const next = this.createId();
    this.storage.setItem(key, next);
    return next;
  }

  acknowledge(code: string, connectionId: string): void {
    if (this.storage.getItem(this.cancelledKey(code)) === connectionId) {
      this.storage.removeItem(this.currentKey(code));
      if (this.storage.getItem(this.pendingKey(code)) === connectionId) this.storage.removeItem(this.pendingKey(code));
      this.storage.removeItem(this.cancelledKey(code));
      return;
    }
    this.storage.setItem(this.currentKey(code), connectionId);
    this.storage.removeItem(this.pendingKey(code));
  }

  cancel(code: string, connectionId: string): void {
    // Keep the pending ID available until an already-scheduled request uses it.
    // Its late acknowledgement will then be discarded instead of restoring a
    // lease that Leave has invalidated on the server.
    this.storage.setItem(this.cancelledKey(code), connectionId);
  }

  clear(code: string): void {
    this.generations.set(code.toUpperCase(), this.generation(code) + 1);
    this.storage.removeItem(this.currentKey(code));
    this.storage.removeItem(this.pendingKey(code));
    this.storage.removeItem(this.cancelledKey(code));
  }

  async issue<T extends { connectionId: string }>(
    code: string,
    scope: string,
    operation: string,
    request: (ids: LeaseRequestIds) => Promise<T>,
  ): Promise<T> {
    const flightKey = `${scope}:${operation}`;
    const existing = this.inFlight.get(flightKey);
    if (existing) return existing as Promise<T>;
    const generation = this.generation(code);
    const previous = this.tails.get(scope) ?? Promise.resolve();
    const flight = previous.then(async () => {
      const result = await request({ expectedConnectionId: this.current(code), requestedConnectionId: this.requested(code) });
      if (this.generation(code) === generation) this.acknowledge(code, result.connectionId);
      return result;
    }, async () => {
      const result = await request({ expectedConnectionId: this.current(code), requestedConnectionId: this.requested(code) });
      if (this.generation(code) === generation) this.acknowledge(code, result.connectionId);
      return result;
    });
    const tail = flight.then(() => undefined, () => undefined);
    this.inFlight.set(flightKey, flight);
    this.tails.set(scope, tail);
    const cleanup = () => {
      if (this.inFlight.get(flightKey) === flight) this.inFlight.delete(flightKey);
      if (this.tails.get(scope) === tail) this.tails.delete(scope);
    };
    void flight.then(cleanup, cleanup);
    return flight;
  }

  private currentKey(code: string): string {
    return `abominations-connection-id:${code.toUpperCase()}`;
  }

  private pendingKey(code: string): string {
    return `${this.currentKey(code)}:pending`;
  }

  private cancelledKey(code: string): string {
    return `${this.currentKey(code)}:cancelled`;
  }

  private generation(code: string): number {
    return this.generations.get(code.toUpperCase()) ?? 0;
  }
}
