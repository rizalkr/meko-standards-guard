import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckSquare,
  Menu,
  Network,
  RefreshCw,
  Shield,
  X
} from "lucide-react";
import { ApprovalQueueView } from "./components/ApprovalQueueView";
import { BenchmarkView } from "./components/BenchmarkView";
import { BlastRadiusView } from "./components/BlastRadiusView";
import { KpiStrip } from "./components/KpiStrip";
import { StatusPill } from "./components/StatusPill";
import { TimelineView } from "./components/TimelineView";
import {
  fetchBenchmark,
  fetchOverview,
  fetchQueue,
  fetchRules,
  fetchTimeline
} from "./lib/api";
import type {
  BenchmarkReport,
  OverviewResponse,
  QueueResponse,
  RuleSummary,
  TimelineEvent
} from "./lib/types";

type NavView = "queue" | "timeline" | "blast" | "benchmark";

function readViewFromUrl(): NavView {
  const param = new URLSearchParams(window.location.search).get("view");
  if (param === "timeline" || param === "blast" || param === "benchmark" || param === "queue") {
    return param;
  }
  return "queue";
}

export function App() {
  const [activeView, setActiveView] = useState<NavView>(() => readViewFromUrl());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(
    null
  );

  const showToast = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 3500);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, q, tl, r, bm] = await Promise.all([
        fetchOverview(),
        fetchQueue(),
        fetchTimeline(),
        fetchRules(),
        fetchBenchmark()
      ]);
      setOverview(ov);
      setQueue(q);
      setEvents(tl.events);
      setRules(r.rules);
      setBenchmark(bm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load governance data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const onPopState = () => setActiveView(readViewFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (view: NavView) => {
    setActiveView(view);
    setMobileMenuOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.pushState({}, "", url);
  };

  const pendingCount = queue?.pending.length ?? overview?.counts.privateMemories ?? 0;

  const navItems: Array<{
    id: NavView;
    label: string;
    icon: typeof CheckSquare;
    badge?: number;
  }> = [
    { id: "queue", label: "Approval Queue", icon: CheckSquare, badge: pendingCount },
    { id: "timeline", label: "Cross-Agent Timeline", icon: Activity, badge: events.length },
    { id: "blast", label: "ADR Blast Radius", icon: Network, badge: rules.length || 8 },
    { id: "benchmark", label: "A/B Benchmark", icon: BarChart3 }
  ];

  const modeBadgeLabel =
    overview?.mode === "mock"
      ? "MOCK · 0 LIVE QUOTA"
      : `${(overview?.mode ?? "mock").toUpperCase()} MODE`;

  return (
    <div className="min-h-screen bg-[#090B0E] text-[#E6EDF3]">
      <div className="mx-auto flex min-h-screen max-w-[1440px]">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-[#101318] lg:flex">
          <div className="border-b border-white/10 px-4 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10">
                <Shield className="size-4 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold tracking-tight text-[#E6EDF3]">
                  Meko Standards Guard
                </p>
                <p className="truncate font-mono text-[11px] text-[#8B949E]">
                  {overview?.datapack ?? "payledger-standards-guard"}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <StatusPill
                label={modeBadgeLabel}
                tone={overview?.mode === "mock" ? "emerald" : "amber"}
                mono
              />
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-3" aria-label="Primary governance navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "bg-[#171B23] text-[#E6EDF3] ring-1 ring-white/10"
                      : "text-[#8B949E] hover:bg-white/[0.03] hover:text-[#E6EDF3]"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className={`size-4 shrink-0 ${active ? "text-sky-400" : ""}`} />
                    <span>{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-slate-300">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-white/10 p-4 text-[11px] text-[#8B949E]">
            <p className="font-medium text-slate-300">Anti-Context-Poisoning (ADR-008)</p>
            <p className="mt-1 leading-relaxed">
              Autonomous MCP agents cannot invoke <span className="font-mono">memory_promote</span>. Human review is required here or via CLI.
            </p>
          </div>
        </aside>

        {/* Main Column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/10 bg-[#090B0E]/95 px-4 py-3 backdrop-blur-sm sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Toggle navigation"
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="rounded-md border border-white/10 bg-[#101318] p-1.5 text-slate-300 lg:hidden"
              >
                {mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
              </button>
              <div>
                <h1 className="text-sm font-semibold text-[#E6EDF3]">
                  Local Governance Control Plane
                </h1>
                <p className="hidden text-xs text-[#8B949E] sm:block">
                  One Memory, Every Coding Agent — PayLedger Mini ADLC Oversight
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="sm:hidden">
                <StatusPill
                  label={overview?.mode === "mock" ? "MOCK" : (overview?.mode ?? "mock")}
                  tone={overview?.mode === "mock" ? "emerald" : "amber"}
                  mono
                />
              </div>
              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#101318] px-3 py-1.5 text-xs font-medium text-[#E6EDF3] transition-colors hover:border-white/20 disabled:opacity-50"
              >
                <RefreshCw className={`size-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>
          </header>

          {/* Mobile Drawer Navigation */}
          {mobileMenuOpen && (
            <div className="border-b border-white/10 bg-[#101318] p-3 lg:hidden">
              <nav className="grid grid-cols-2 gap-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(item.id)}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs font-medium ${
                        active
                          ? "border-sky-500/40 bg-[#171B23] text-[#E6EDF3]"
                          : "border-white/10 text-[#8B949E]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="size-3.5 shrink-0" />
                        <span>{item.label}</span>
                      </span>
                      {item.badge !== undefined && (
                        <span className="font-mono text-[10px] tabular-nums">{item.badge}</span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          <main className="flex-1 space-y-6 p-4 sm:p-6">
            {error && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
                <span>Failed to reach local governance server: {error}</span>
                <button
                  type="button"
                  onClick={() => void loadAll()}
                  className="rounded border border-rose-400/30 bg-rose-500/20 px-2.5 py-1 font-medium text-rose-100 hover:bg-rose-500/30"
                >
                  Retry
                </button>
              </div>
            )}

            <KpiStrip overview={overview} loading={loading} />

            {activeView === "queue" && (
              <ApprovalQueueView
                queue={queue}
                loading={loading}
                mode={overview?.mode ?? "mock"}
                onMutated={loadAll}
                onNotify={showToast}
              />
            )}

            {activeView === "timeline" && <TimelineView events={events} loading={loading} />}

            {activeView === "blast" && <BlastRadiusView rules={rules} loadingRules={loading} />}

            {activeView === "benchmark" && <BenchmarkView report={benchmark} loading={loading} />}
          </main>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 rounded-md border px-4 py-2.5 text-xs font-medium shadow-xl ${
            toast.tone === "error"
              ? "border-rose-500/40 bg-[#1A1014] text-rose-200"
              : "border-emerald-500/40 bg-[#0E1915] text-emerald-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
