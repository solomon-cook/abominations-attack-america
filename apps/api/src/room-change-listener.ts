import { Client } from "pg";

const channel = "room_updated";
const minRetryMs = 250;
const maxRetryMs = 10_000;

export class RoomChangeListener {
  private client?: Client;
  private retryTimer?: NodeJS.Timeout;
  private retryAttempt = 0;
  private closed = false;
  private isReady = false;

  constructor(
    private readonly connectionString: string,
    private readonly onRoomChanged: (roomCode: string) => void | Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly onReadinessChanged: (ready: boolean) => void = () => undefined,
  ) {}

  get ready() {
    return this.isReady;
  }

  async start() {
    if (this.closed) throw new Error("Room change listener is closed.");
    await this.connect();
  }

  async close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.setReady(false);
    const client = this.client;
    this.client = undefined;
    if (client) await client.end().catch(() => undefined);
  }

  private async connect() {
    if (this.closed) return;
    const client = new Client({ connectionString: this.connectionString });
    this.client = client;
    client.on("notification", (notification) => {
      if (notification.channel !== channel || !notification.payload || !/^[A-F0-9]{6}$/.test(notification.payload)) return;
      void Promise.resolve(this.onRoomChanged(notification.payload)).catch((error) => this.onError(error));
    });
    client.on("error", (error) => this.handleConnectionLoss(client, error));
    client.on("end", () => this.handleConnectionLoss(client, new Error("PostgreSQL room-notification connection ended.")));

    try {
      await client.connect();
      await client.query(`LISTEN ${channel}`);
      if (this.closed) {
        await client.end().catch(() => undefined);
        return;
      }
      this.retryAttempt = 0;
      this.setReady(true);
    } catch (error) {
      this.handleConnectionLoss(client, error);
      throw error;
    }
  }

  private handleConnectionLoss(client: Client, error: unknown) {
    if (this.client !== client || this.closed) return;
    this.client = undefined;
    this.setReady(false);
    this.onError(error);
    void client.end().catch(() => undefined);
    if (this.retryTimer) return;
    const delay = Math.min(maxRetryMs, minRetryMs * (2 ** this.retryAttempt));
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect().catch((connectError) => this.onError(connectError));
    }, delay);
    this.retryTimer.unref();
  }

  private setReady(ready: boolean) {
    if (this.isReady === ready) return;
    this.isReady = ready;
    this.onReadinessChanged(ready);
  }
}
