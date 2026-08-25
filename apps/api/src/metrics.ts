export interface MetricsSnapshot {
  requests: number;
  requestFailures: number;
  commandAccepted: number;
  commandFailed: number;
  reconnects: number;
  websocketConnections: number;
  websocketFailures: number;
  roomsCompleted: number;
  roomsAbandoned: number;
  latencySamples: number;
  latencyTotalMs: number;
  serverErrors: number;
}

export class ApiMetrics {
  private values: MetricsSnapshot = {
    requests: 0,
    requestFailures: 0,
    commandAccepted: 0,
    commandFailed: 0,
    reconnects: 0,
    websocketConnections: 0,
    websocketFailures: 0,
    roomsCompleted: 0,
    roomsAbandoned: 0,
    latencySamples: 0,
    latencyTotalMs: 0,
    serverErrors: 0,
  };

  request(): void { this.values.requests += 1; }
  requestFailure(): void { this.values.requestFailures += 1; }
  commandAccepted(): void { this.values.commandAccepted += 1; }
  commandFailed(): void { this.values.commandFailed += 1; }
  reconnect(): void { this.values.reconnects += 1; }
  websocketConnection(): void { this.values.websocketConnections += 1; }
  websocketFailure(): void { this.values.websocketFailures += 1; }
  roomCompleted(): void { this.values.roomsCompleted += 1; }
  roomAbandoned(): void { this.values.roomsAbandoned += 1; }
  serverError(): void { this.values.serverErrors += 1; }
  latency(milliseconds: number): void {
    this.values.latencySamples += 1;
    this.values.latencyTotalMs += Math.max(0, milliseconds);
  }
  snapshot(): MetricsSnapshot {
    return { ...this.values };
  }
}
