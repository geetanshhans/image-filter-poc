// Response shape for GET /api/health. Imported by both the API (when the
// route is implemented) and the frontend (so the /health page is fully typed).

export type HealthOverall = "ok" | "degraded";

export interface HealthCheck {
  ok: boolean;
  message: string;
  latencyMs: number;
  // Subsystem-specific extras. Free-form so we don't have to bump this type
  // every time we add a new metric to a probe.
  detail?: Record<string, unknown>;
}

export interface HealthResponse {
  status: HealthOverall;
  timestamp: string;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
    worker: HealthCheck;
    s3: HealthCheck;
  };
}
