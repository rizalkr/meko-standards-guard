import type {
  BenchmarkReport,
  ExplainRuleResponse,
  OverviewResponse,
  QueueResponse,
  RuleSummary,
  SpecCheckResult,
  TimelineEvent
} from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

export function fetchOverview(): Promise<OverviewResponse> {
  return requestJson<OverviewResponse>("/api/overview");
}

export function fetchQueue(): Promise<QueueResponse> {
  return requestJson<QueueResponse>("/api/queue");
}

export function approveMemory(
  memoryId: string,
  body: { reason: string; promotedBy: string }
): Promise<{ promoted: { id: string } }> {
  return requestJson(`/api/queue/${encodeURIComponent(memoryId)}/approve`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function simulateViolation(
  scenario: "S3" | "S2" | "S4" | "S1"
): Promise<{ memory: { id: string; ruleId?: string } }> {
  return requestJson("/api/demo/simulate-violation", {
    method: "POST",
    body: JSON.stringify({ scenario })
  });
}

export function fetchTimeline(params?: {
  kind?: string;
  ruleId?: string;
  q?: string;
}): Promise<{ events: TimelineEvent[]; total: number }> {
  const search = new URLSearchParams();
  if (params?.kind && params.kind !== "all") {
    search.set("kind", params.kind);
  }
  if (params?.ruleId) {
    search.set("ruleId", params.ruleId);
  }
  if (params?.q) {
    search.set("q", params.q);
  }
  const qs = search.toString();
  return requestJson(`/api/timeline${qs ? `?${qs}` : ""}`);
}

export function fetchRules(): Promise<{ rules: RuleSummary[] }> {
  return requestJson("/api/rules");
}

export function fetchRuleDetail(id: string): Promise<ExplainRuleResponse> {
  return requestJson(`/api/rules/${encodeURIComponent(id)}`);
}

export function fetchSpecCheck(file = "specs/001-refunds-rfc.md"): Promise<SpecCheckResult> {
  return requestJson(`/api/spec-check?file=${encodeURIComponent(file)}`);
}

export function fetchBenchmark(): Promise<BenchmarkReport> {
  return requestJson("/api/benchmark");
}
