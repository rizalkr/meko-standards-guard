import { useEffect, useState } from "react";
import { CheckCircle2, Lock, PlusCircle, ShieldCheck, X } from "lucide-react";
import { approveMemory, simulateViolation } from "../lib/api";
import type { GuardMode, MemoryRecord, QueueResponse } from "../lib/types";
import { StatusPill } from "./StatusPill";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function ApprovalQueueView({
  queue,
  loading,
  mode,
  onMutated,
  onNotify
}: {
  queue: QueueResponse | null;
  loading: boolean;
  mode: GuardMode;
  onMutated: () => Promise<void>;
  onNotify: (message: string, tone?: "success" | "error") => void;
}) {
  const [scenario, setScenario] = useState<"S3" | "S2" | "S4" | "S1">("S3");
  const [simulating, setSimulating] = useState(false);

  const [selectedMemory, setSelectedMemory] = useState<MemoryRecord | null>(null);
  const [promotedBy, setPromotedBy] = useState("maintainer");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!selectedMemory) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        setSelectedMemory(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedMemory, submitting]);

  const openModal = (memory: MemoryRecord) => {
    setSelectedMemory(memory);
    setFormError(null);
    setReason(
      `Verified root cause for ${memory.ruleId ?? "standard"} and approved cross-agent vaccination.`
    );
  };

  const handleSimulate = async () => {
    setSimulating(true);
    try {
      const res = await simulateViolation(scenario);
      await onMutated();
      onNotify(
        `Simulated ${res.memory.ruleId ?? scenario} violation from cursor into private quarantine.`,
        "success"
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Failed to simulate violation.", "error");
    } finally {
      setSimulating(false);
    }
  };

  const handleApproveSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedMemory) {
      return;
    }

    const trimmedReason = reason.trim();
    const trimmedBy = promotedBy.trim() || "maintainer";
    if (trimmedReason.length < 3) {
      setFormError("Promotion rationale must be at least 3 characters.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await approveMemory(selectedMemory.id, {
        reason: trimmedReason,
        promotedBy: trimmedBy
      });
      setSelectedMemory(null);
      await onMutated();
      onNotify(
        `Promoted ${selectedMemory.id} (${selectedMemory.ruleId ?? "rule"}) to shared institutional memory.`,
        "success"
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const pending = queue?.pending ?? [];
  const shared = queue?.shared ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#101318] p-4">
        <div>
          <h2 className="text-sm font-semibold text-[#E6EDF3]">
            Human-Gated Promotion Queue (ADR-008)
          </h2>
          <p className="mt-0.5 text-xs text-[#8B949E]">
            Candidate violation learnings stay quarantined in <span className="font-mono text-slate-300">tier: private</span> until a maintainer explicitly promotes them to <span className="font-mono text-slate-300">tier: shared</span>.
          </p>
        </div>

        {mode === "mock" ? (
          <div className="flex items-center gap-2">
            <label htmlFor="demo-scenario" className="sr-only">
              Demo violation scenario
            </label>
            <select
              id="demo-scenario"
              value={scenario}
              onChange={(e) => setScenario(e.target.value as "S3" | "S2" | "S4" | "S1")}
              className="rounded-md border border-white/10 bg-[#171B23] px-2.5 py-1.5 font-mono text-xs text-[#E6EDF3] focus:border-sky-500/60 focus:outline-none"
            >
              <option value="S3">S3 · Ledger UPDATE</option>
              <option value="S2">S2 · Missing Idempotency</option>
              <option value="S4">S4 · PII Leak</option>
              <option value="S1">S1 · Float Arithmetic</option>
            </select>
            <button
              type="button"
              onClick={handleSimulate}
              disabled={simulating}
              className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-500/25 disabled:opacity-50"
            >
              <PlusCircle className="size-3.5 shrink-0" />
              <span>{simulating ? "Simulating..." : "Simulate Cursor Violation"}</span>
            </button>
          </div>
        ) : (
          <StatusPill label={`Live mode (${mode})`} tone="amber" />
        )}
      </div>

      {/* Pending Private Quarantine */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8B949E]">
            Pending Private Quarantine ({pending.length})
          </h3>
          <span className="font-mono text-[11px] text-[#8B949E]">
            Isolated by agentId
          </span>
        </div>

        {loading && !queue ? (
          <div className="space-y-2.5">
            {Array.from({ length: 2 }).map((_, idx) => (
              <div
                key={idx}
                className="h-24 animate-pulse rounded-lg border border-white/10 bg-[#101318] p-4"
              />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/15 bg-[#101318]/60 p-8 text-center">
            <ShieldCheck className="mx-auto size-7 text-emerald-400" />
            <p className="mt-2.5 text-sm font-medium text-[#E6EDF3]">
              No pending private candidate memories
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-[#8B949E]">
              When Cursor or another coding agent triggers an AST or PII violation during{" "}
              <span className="font-mono text-slate-300">standards-guard check</span>, the quarantined finding appears here for review.
            </p>
            {mode === "mock" && (
              <button
                type="button"
                onClick={handleSimulate}
                disabled={simulating}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-[#171B23] px-3 py-1.5 text-xs font-medium text-[#E6EDF3] hover:border-white/25"
              >
                <PlusCircle className="size-3.5 shrink-0 text-sky-400" />
                <span>Simulate Cursor {scenario} Violation</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {pending.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-4 rounded-lg border border-white/10 bg-[#101318] p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label="PRIVATE QUARANTINE" tone="amber" mono />
                    {item.ruleId && <StatusPill label={item.ruleId} tone="rose" mono />}
                    <span className="font-mono text-xs text-slate-300">
                      agent:{item.agentId}
                    </span>
                    <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                      {item.id} · {formatTimestamp(item.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[#E6EDF3]">{item.content}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-white/10 bg-[#171B23] px-1.5 py-0.5 font-mono text-[10px] text-[#8B949E]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => openModal(item)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
                  >
                    <CheckCircle2 className="size-3.5 shrink-0" />
                    <span>Approve & Promote</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Promoted Shared Institutional Memory */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8B949E]">
            Promoted Shared Institutional Memory ({shared.length})
          </h3>
          <span className="font-mono text-[11px] text-[#8B949E]">
            Visible to all connected agents via context_search
          </span>
        </div>

        {shared.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-[#101318] p-5 text-xs text-[#8B949E]">
            No candidate memories have been promoted to shared tier yet.
          </div>
        ) : (
          <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-[#101318]">
            {shared.map((item) => (
              <div key={item.id} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label="SHARED" tone="emerald" mono />
                  {item.ruleId && <StatusPill label={item.ruleId} tone="sky" mono />}
                  <span className="font-mono text-[11px] text-slate-300">
                    origin:{item.agentId} → promotedBy:{item.promotedBy ?? "maintainer"}
                  </span>
                  <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                    {formatTimestamp(item.promotedAt ?? item.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-[#E6EDF3]">{item.content}</p>
                {item.promotionReason && (
                  <p className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-xs text-emerald-200">
                    Maintainer rationale: {item.promotionReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Approval Confirmation Modal */}
      {selectedMemory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="promote-modal-title"
          aria-describedby="promote-modal-desc"
        >
          <div className="w-full max-w-lg rounded-lg border border-white/15 bg-[#101318] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Lock className="size-4 shrink-0 text-emerald-400" />
                <h4 id="promote-modal-title" className="text-sm font-semibold text-[#E6EDF3]">
                  Confirm Memory Promotion (ADR-008)
                </h4>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => !submitting && setSelectedMemory(null)}
                className="rounded p-1 text-[#8B949E] hover:bg-white/5 hover:text-[#E6EDF3]"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleApproveSubmit} className="space-y-4 p-5">
              <p id="promote-modal-desc" className="text-xs leading-relaxed text-[#8B949E]">
                Promoting <span className="font-mono text-slate-200">{selectedMemory.id}</span> exposes this lesson across all coding agents (OpenCode, Claude Code, Codex, Kiro, VS Code Copilot) and writes an immutable maintainer conversation audit entry.
              </p>

              <div className="rounded border border-white/10 bg-[#171B23] p-3 text-xs text-slate-200">
                {selectedMemory.content}
              </div>

              <div>
                <label
                  htmlFor="promoted-by-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Reviewer / Maintainer ID
                </label>
                <input
                  id="promoted-by-input"
                  type="text"
                  value={promotedBy}
                  onChange={(e) => setPromotedBy(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-white/10 bg-[#090B0E] px-3 py-1.5 font-mono text-xs text-[#E6EDF3] focus:border-emerald-500/60 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="promote-reason-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Promotion Rationale (required)
                </label>
                <textarea
                  id="promote-reason-input"
                  rows={3}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (formError) {
                      setFormError(null);
                    }
                  }}
                  aria-describedby={formError ? "promote-reason-error" : undefined}
                  placeholder="Explain why this violation pattern is safe and authoritative for all agents..."
                  className="mt-1.5 w-full rounded-md border border-white/10 bg-[#090B0E] px-3 py-2 text-xs text-[#E6EDF3] focus:border-emerald-500/60 focus:outline-none"
                />
                {formError && (
                  <p id="promote-reason-error" className="mt-1 text-xs text-rose-400">
                    {formError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setSelectedMemory(null)}
                  className="rounded-md border border-white/10 bg-[#171B23] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  <span>{submitting ? "Promoting..." : "Promote to Shared Tier"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
