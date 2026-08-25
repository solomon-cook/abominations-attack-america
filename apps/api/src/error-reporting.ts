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
  private totalReports = 0;
  private totalAlerts = 0;
  private alertWindowStartedAt = 0;
  private reportsInWindow = 0;
  private alertedInWindow = false;

  constructor(
    private readonly sink: (report: ErrorReport & { alert?: boolean }) => void = (report) => console.error(JSON.stringify(report)),
    private readonly alertThreshold = 5,
    private readonly alertWindowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
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
    if (this.alertWindowStartedAt === 0 || current - this.alertWindowStartedAt >= this.alertWindowMs) {
      this.alertWindowStartedAt = current;
      this.reportsInWindow = 0;
      this.alertedInWindow = false;
    }
    this.reportsInWindow += 1;
    const shouldAlert = this.reportsInWindow >= this.alertThreshold && !this.alertedInWindow;
    this.sink(shouldAlert ? { ...report, alert: true } : report);
    if (shouldAlert) {
      this.totalAlerts += 1;
      this.alertedInWindow = true;
    }
    return report;
  }

  snapshot(): ErrorReporterSnapshot {
    return { reports: this.totalReports, alerts: this.totalAlerts, recentByCategory: { ...this.reportsByCategory } };
  }
}
