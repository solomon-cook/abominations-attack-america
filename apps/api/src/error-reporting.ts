export type ErrorCategory = "http" | "command" | "persistence" | "websocket" | "divergence" | "deployment";

export interface ErrorReport {
  category: ErrorCategory;
  message: string;
  method?: string;
  path?: string;
  roomCode?: string;
  actionId?: string;
  at?: string;
}

export type ErrorReportEvent = ErrorReport & { alert?: boolean; alertCount?: number; alertThreshold?: number };

export interface ErrorReporterSnapshot {
  reports: number;
  alerts: number;
  recentByCategory: Readonly<Record<ErrorCategory, number>>;
}

const categories: readonly ErrorCategory[] = ["http", "command", "persistence", "websocket", "divergence", "deployment"];

function redact(value: string): string {
  return value
    .replace(/([?&](?:token|accessToken|roomToken|x-room-token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(\"(?:token|accessToken|roomToken|x-room-token)\"\s*:\s*\")[^\"]+(\")/gi, "$1[REDACTED]$2");
}

export class ErrorReporter {
  private readonly reportsByCategory = Object.fromEntries(categories.map((category) => [category, 0])) as Record<ErrorCategory, number>;
  private readonly alertWindows = new Map<ErrorCategory, { startedAt: number; count: number; alerted: boolean }>();
  private totalReports = 0;
  private totalAlerts = 0;

  constructor(
    private readonly sink: (report: ErrorReportEvent) => void = (report) => console.error(JSON.stringify(report)),
    private readonly alertThreshold = 5,
    private readonly alertWindowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
    private readonly immediateAlertCategories: ReadonlySet<ErrorCategory> = new Set(["persistence", "divergence", "deployment"]),
  ) {}

  report(input: ErrorReport): ErrorReport {
    const report: ErrorReport = {
      ...input,
      message: redact(input.message),
      path: input.path ? redact(input.path) : undefined,
      at: input.at ?? new Date(this.now()).toISOString(),
    };
    this.totalReports += 1;
    this.reportsByCategory[report.category] += 1;
    const current = this.now();
    let window = this.alertWindows.get(report.category);
    if (!window || current - window.startedAt >= this.alertWindowMs) {
      window = { startedAt: current, count: 0, alerted: false };
      this.alertWindows.set(report.category, window);
    }
    window.count += 1;
    const threshold = this.immediateAlertCategories.has(report.category) ? 1 : this.alertThreshold;
    const shouldAlert = window.count >= threshold && !window.alerted;
    this.sink(shouldAlert ? { ...report, alert: true, alertCount: window.count, alertThreshold: threshold } : report);
    if (shouldAlert) {
      this.totalAlerts += 1;
      window.alerted = true;
    }
    return report;
  }

  snapshot(): ErrorReporterSnapshot {
    return { reports: this.totalReports, alerts: this.totalAlerts, recentByCategory: { ...this.reportsByCategory } };
  }
}

type AlertFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export interface ErrorAggregateWrite {
  category: ErrorCategory;
  /** UTC calendar date; no request, room, user, or message data is retained. */
  bucketDate: string;
}

export interface ErrorAggregatePersistence {
  increment(input: ErrorAggregateWrite): Promise<void>;
  pruneBefore(bucketDate: string): Promise<void>;
}

export function createDurableErrorAggregateWriter(
  persistence: ErrorAggregatePersistence,
  retentionDays = 90,
): (input: ErrorAggregateWrite) => Promise<void> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("Error aggregate retention must be a positive whole number of days.");
  return async (input) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.bucketDate)) throw new Error("Error aggregate bucket date must use YYYY-MM-DD.");
    const bucketStart = new Date(`${input.bucketDate}T00:00:00.000Z`);
    if (Number.isNaN(bucketStart.getTime()) || bucketStart.toISOString().slice(0, 10) !== input.bucketDate) {
      throw new Error("Error aggregate bucket date is invalid.");
    }
    const retentionCutoff = new Date(bucketStart);
    retentionCutoff.setUTCDate(retentionCutoff.getUTCDate() - retentionDays);
    await persistence.increment(input);
    await persistence.pruneBefore(retentionCutoff.toISOString().slice(0, 10));
  };
}

/** Deliver threshold alerts without putting network delivery on the request path. */
export function createErrorReporterSink(options: {
  endpoint?: string;
  fetcher?: AlertFetch;
  log?: (line: string) => void;
  persistAggregate?: (aggregate: ErrorAggregateWrite) => Promise<void>;
  deliveryTimeoutMs?: number;
} = {}): (report: ErrorReportEvent) => void {
  const endpoint = options.endpoint;
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const log = options.log ?? ((line) => console.error(line));
  const deliveryTimeoutMs = options.deliveryTimeoutMs ?? 5_000;
  if (!Number.isInteger(deliveryTimeoutMs) || deliveryTimeoutMs < 1) throw new Error("Error alert delivery timeout must be a positive whole number of milliseconds.");
  return (report) => {
    log(JSON.stringify({ event: report.alert ? "alert.error-threshold" : "error.reported", ...report }));
    if (options.persistAggregate) {
      const parsedAt = new Date(report.at ?? Date.now());
      const bucketDate = Number.isNaN(parsedAt.getTime()) ? new Date().toISOString().slice(0, 10) : parsedAt.toISOString().slice(0, 10);
      void options.persistAggregate({ category: report.category, bucketDate }).catch((error: unknown) => {
        log(`error aggregate persistence failed: ${error instanceof Error ? error.message : "unknown error"}`);
      });
    }
    if (!endpoint || report.alert !== true) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deliveryTimeoutMs);
    const externalAlert = {
      event: "alert.error-threshold",
      category: report.category,
      at: report.at,
      count: report.alertCount,
      threshold: report.alertThreshold,
    };
    void fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(externalAlert),
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) log(`error alert delivery failed with HTTP ${response.status}`);
    }).catch((error: unknown) => {
      log(`error alert delivery failed: ${error instanceof Error ? redact(error.message) : "unknown error"}`);
    }).finally(() => {
      clearTimeout(timeout);
    });
  };
}
