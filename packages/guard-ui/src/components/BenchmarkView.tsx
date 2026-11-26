import { BarChart3, Clock } from "lucide-react";
import type { BenchmarkReport } from "../lib/types";
import { StatusPill } from "./StatusPill";

export function BenchmarkView({
  report,
  loading
}: {
  report: BenchmarkReport | null;
  loading: boolean;
}) {
  if (loading && !report) {
    return (
      <div className="h-64 animate-pulse rounded-lg border border-white/10 bg-[#101318]" />
    );
  }

  if (!report) {
    return (
      <div className="rounded-lg border border-white/10 bg-[#101318] p-6 text-xs text-[#8B949E]">
        Benchmark data is unavailable.
      </div>
    );
  }

  const isRecorded = report.source === "recorded";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/10 bg-[#101318] p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 shrink-0 text-sky-400" />
            <h2 className="text-sm font-semibold text-[#E6EDF3]">
              5-Task A/B Evaluation: Baseline vs. Meko Standards Guard
            </h2>
          </div>
          <p className="max-w-3xl text-xs leading-relaxed text-[#8B949E]">
            {report.note}
          </p>
        </div>

        <StatusPill
          label={isRecorded ? "RECORDED (TIKTOKEN)" : "PENDING WEEK 6 LIVE RUN"}
          tone={isRecorded ? "emerald" : "amber"}
          mono
        />
      </div>

      {isRecorded ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-[#101318] p-4">
            <span className="text-xs text-[#8B949E]">Total Rule Violations</span>
            <div className="mt-2 flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-xl font-semibold text-emerald-300">
                {report.summary.guardedTotalViolations}
                <span className="ml-1.5 text-xs font-normal text-[#8B949E]">
                  vs {report.summary.baselineTotalViolations} baseline
                </span>
              </span>
              {report.summary.violationReductionPct !== null && (
                <StatusPill label={`-${report.summary.violationReductionPct}%`} tone="emerald" mono />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#101318] p-4">
            <span className="text-xs text-[#8B949E]">Avg Correction Turns</span>
            <div className="mt-2 font-mono text-xl font-semibold text-[#E6EDF3] tabular-nums">
              {report.summary.guardedAvgTurns}
              <span className="ml-1.5 text-xs font-normal text-[#8B949E]">
                vs {report.summary.baselineAvgTurns} baseline
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#101318] p-4">
            <span className="text-xs text-[#8B949E]">Total Prompt Tokens ({report.tokenizer})</span>
            <div className="mt-2 flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-xl font-semibold text-[#E6EDF3]">
                {report.summary.guardedTotalTokens.toLocaleString()}
                <span className="ml-1.5 text-xs font-normal text-[#8B949E]">
                  vs {report.summary.baselineTotalTokens.toLocaleString()}
                </span>
              </span>
              {report.summary.tokenDeltaPct !== null && (
                <StatusPill
                  label={`${report.summary.tokenDeltaPct > 0 ? "+" : ""}${report.summary.tokenDeltaPct}%`}
                  tone={report.summary.tokenDeltaPct <= 0 ? "emerald" : "neutral"}
                  mono
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
          <Clock className="size-4 shrink-0" />
          <span>
            No <span className="font-mono">fixtures/benchmark/results.json</span> recorded yet. Below is the exact 5-task matrix to be populated during Week 6 live Meko execution without fabricating placeholder scores.
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#101318]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-[#171B23] text-[#8B949E]">
              <th className="px-4 py-2.5 font-medium">Task</th>
              <th className="px-4 py-2.5 font-medium">Endpoint</th>
              <th className="px-4 py-2.5 font-medium">Rules</th>
              <th className="px-4 py-2.5 text-right font-medium">Baseline Violations</th>
              <th className="px-4 py-2.5 text-right font-medium">Guarded Violations</th>
              <th className="px-4 py-2.5 text-right font-medium">Turns (Base / Guard)</th>
              <th className="px-4 py-2.5 text-right font-medium">Tokens (Base / Guard)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {report.tasks.map((row) => (
              <tr key={row.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium text-[#E6EDF3]">
                  <span className="mr-2 font-mono text-[#8B949E]">{row.id}</span>
                  {row.task}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-sky-300">
                  {row.targetEndpoint}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {row.focusRules.map((rule) => (
                      <span
                        key={rule}
                        className="rounded border border-white/10 bg-[#171B23] px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                      >
                        {rule}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-[#8B949E]">
                  {row.baseline ? row.baseline.violations : "--"}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-300">
                  {row.guarded ? row.guarded.violations : "--"}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-[#8B949E]">
                  {row.baseline && row.guarded
                    ? `${row.baseline.correctionTurns} / ${row.guarded.correctionTurns}`
                    : "--"}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-[#8B949E]">
                  {row.baseline && row.guarded
                    ? `${row.baseline.promptTokens} / ${row.guarded.promptTokens}`
                    : "--"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
