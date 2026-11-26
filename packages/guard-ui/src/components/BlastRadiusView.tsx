import { useEffect, useState } from "react";
import { AlertTriangle, FileCode2, FlaskConical, Network, Route } from "lucide-react";
import { fetchRuleDetail, fetchSpecCheck } from "../lib/api";
import type { ExplainRuleResponse, RuleSummary, SpecCheckResult } from "../lib/types";
import { StatusPill } from "./StatusPill";

export function BlastRadiusView({
  rules,
  loadingRules
}: {
  rules: RuleSummary[];
  loadingRules: boolean;
}) {
  const [selectedRuleId, setSelectedRuleId] = useState<string>("S3");
  const [detail, setDetail] = useState<ExplainRuleResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [specResult, setSpecResult] = useState<SpecCheckResult | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);

  useEffect(() => {
    if (rules.length > 0 && !rules.some((r) => r.id === selectedRuleId)) {
      setSelectedRuleId(rules[0].id);
    }
  }, [rules, selectedRuleId]);

  useEffect(() => {
    if (!selectedRuleId) {
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetchRuleDetail(selectedRuleId)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : "Failed to load rule detail.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRuleId]);

  useEffect(() => {
    let cancelled = false;
    fetchSpecCheck("specs/001-refunds-rfc.md")
      .then((res) => {
        if (!cancelled) {
          setSpecResult(res);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSpecError(err instanceof Error ? err.message : "Failed to evaluate RFC spec.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left rule selector list */}
        <div className="space-y-2 lg:col-span-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8B949E]">
              Enforced Standards (S1-S8)
            </h3>
            <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
              {rules.length} ADRs
            </span>
          </div>

          {loadingRules && rules.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-white/10 bg-[#101318]"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => {
                const active = rule.id === selectedRuleId;
                return (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => setSelectedRuleId(rule.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-sky-500/50 bg-[#171B23]"
                        : "border-white/10 bg-[#101318] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-sky-300">
                        {rule.id} · {rule.adrId}
                      </span>
                      <StatusPill label={rule.category} tone="neutral" />
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-[#E6EDF3]">
                      {rule.title}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-[#8B949E] tabular-nums">
                      {rule.fileCount} files · {rule.routeCount} routes · {rule.testCount} tests
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right detail & blast radius panel */}
        <div className="space-y-4 lg:col-span-8">
          {detailLoading && !detail ? (
            <div className="h-80 animate-pulse rounded-lg border border-white/10 bg-[#101318]" />
          ) : detailError ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200">
              {detailError}
            </div>
          ) : detail ? (
            <>
              <div className="rounded-lg border border-white/10 bg-[#101318] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Network className="size-4 shrink-0 text-sky-400" />
                    <h3 className="text-sm font-semibold text-[#E6EDF3]">
                      {detail.rule.adrId} ({detail.rule.id}) — {detail.rule.title}
                    </h3>
                  </div>
                  <StatusPill label={detail.rule.adrFile} tone="sky" mono />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-md border border-white/10 bg-[#171B23] p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                      <FileCode2 className="size-3.5 shrink-0 text-sky-400" />
                      <span>Files ({detail.blastRadius.affectedFiles.length})</span>
                    </div>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-[#8B949E]">
                      {detail.blastRadius.affectedFiles.map((file) => (
                        <li key={file} className="truncate" title={file}>
                          {file}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-md border border-white/10 bg-[#171B23] p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                      <Route className="size-3.5 shrink-0 text-amber-400" />
                      <span>Hono Routes ({detail.blastRadius.affectedRoutes.length})</span>
                    </div>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-[#8B949E]">
                      {detail.blastRadius.affectedRoutes.length === 0 ? (
                        <li>No route handlers directly matched</li>
                      ) : (
                        detail.blastRadius.affectedRoutes.map((route) => (
                          <li key={route} className="truncate" title={route}>
                            {route}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>

                  <div className="rounded-md border border-white/10 bg-[#171B23] p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                      <FlaskConical className="size-3.5 shrink-0 text-emerald-400" />
                      <span>Vitest Suites ({detail.blastRadius.affectedTests.length})</span>
                    </div>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-[#8B949E]">
                      {detail.blastRadius.affectedTests.map((testFile) => (
                        <li key={testFile} className="truncate" title={testFile}>
                          {testFile}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#101318] p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#8B949E]">
                  Canonical ADR Specification
                </h4>
                <pre className="mt-2.5 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#090B0E] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                  {detail.adr.content}
                </pre>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Pre-Implementation Spec Gate Preview */}
      <section className="rounded-lg border border-white/10 bg-[#101318] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-amber-400" />
            <h3 className="text-sm font-semibold text-[#E6EDF3]">
              Pre-Implementation Spec Gate: specs/001-refunds-rfc.md
            </h3>
          </div>
          {specResult && (
            <StatusPill
              label={
                specResult.passed
                  ? "SPEC PASS"
                  : `FAIL · ${specResult.conflicts.length} ADR CONFLICTS`
              }
              tone={specResult.passed ? "emerald" : "rose"}
              mono
            />
          )}
        </div>

        {specError ? (
          <p className="mt-2 text-xs text-rose-400">{specError}</p>
        ) : specResult ? (
          <div className="mt-3 space-y-2">
            {specResult.conflicts.map((conflict, idx) => (
              <div
                key={`${conflict.ruleId}-${conflict.line}-${idx}`}
                className="rounded-md border border-rose-500/20 bg-rose-500/5 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={`${conflict.ruleId}/${conflict.adrId}`} tone="rose" mono />
                  <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                    line {conflict.line}
                  </span>
                </div>
                <p className="mt-1.5 font-medium text-[#E6EDF3]">{conflict.reason}</p>
                <p className="mt-1 text-emerald-300">Remediation: {conflict.remediation}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#8B949E]">Evaluating draft RFC specification...</p>
        )}
      </section>
    </div>
  );
}
