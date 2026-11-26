import { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import type { TimelineEvent, TimelineEventKind } from "../lib/types";
import { StatusPill, type PillTone } from "./StatusPill";

const KIND_META: Record<TimelineEventKind, { label: string; tone: PillTone }> = {
  knowledge: { label: "KB ADR", tone: "sky" },
  memory_private: { label: "Private Memory", tone: "amber" },
  memory_shared: { label: "Shared Memory", tone: "emerald" },
  conversation: { label: "Conversation", tone: "neutral" },
  self_learning: { label: "Self-Learning", tone: "rose" },
  artifact: { label: "Artifact SHA-256", tone: "emerald" }
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function TimelineView({
  events,
  loading
}: {
  events: TimelineEvent[];
  loading: boolean;
}) {
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return events.filter((event) => {
      if (kindFilter !== "all" && event.kind !== kindFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      const text = `${event.title} ${event.summary} ${event.actor} ${event.ruleId ?? ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [events, kindFilter, searchText]);

  const copyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 1500);
    } catch {
      // Clipboard may be unavailable in headless contexts
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-[#101318] p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            ["all", "All Primitives"],
            ["memory_private", "Private"],
            ["memory_shared", "Shared"],
            ["conversation", "Conversations"],
            ["self_learning", "Self-Learning"],
            ["artifact", "Artifacts"],
            ["knowledge", "Knowledge Base"]
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setKindFilter(key)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                kindFilter === key
                  ? "border-sky-500/40 bg-sky-500/15 text-sky-200"
                  : "border-white/10 bg-[#171B23] text-[#8B949E] hover:text-[#E6EDF3]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-[#8B949E]" />
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Filter by rule, actor, or text..."
            className="w-full rounded-md border border-white/10 bg-[#090B0E] py-1.5 pl-8 pr-3 text-xs text-[#E6EDF3] placeholder:text-[#8B949E] focus:border-sky-500/50 focus:outline-none"
          />
        </div>
      </div>

      {loading && events.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="h-20 animate-pulse rounded-lg border border-white/10 bg-[#101318]"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-[#101318] p-8 text-center">
          <p className="text-sm font-medium text-[#E6EDF3]">
            No audit events match the active filter
          </p>
          <p className="mt-1 text-xs text-[#8B949E]">
            Reset the primitive filter or clear the search query to inspect all datapack records.
          </p>
          <button
            type="button"
            onClick={() => {
              setKindFilter("all");
              setSearchText("");
            }}
            className="mt-3 rounded-md border border-white/15 bg-[#171B23] px-3 py-1.5 text-xs font-medium text-[#E6EDF3] hover:border-white/25"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-[#101318]">
          {filtered.map((event) => {
            const meta = KIND_META[event.kind];
            const contentHash =
              typeof event.metadata.contentHash === "string" ? event.metadata.contentHash : null;

            return (
              <div key={event.id} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={meta.label} tone={meta.tone} />
                    {event.ruleId && <StatusPill label={event.ruleId} tone="neutral" mono />}
                    <span className="font-mono text-xs text-slate-300">{event.actor}</span>
                  </div>
                  <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                    {formatTime(event.timestamp)}
                  </span>
                </div>

                <h4 className="text-sm font-medium text-[#E6EDF3]">{event.title}</h4>
                <p className="text-xs leading-relaxed text-[#8B949E]">{event.summary}</p>

                {contentHash && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => copyHash(contentHash)}
                      className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-[#171B23] px-2 py-1 font-mono text-[11px] text-emerald-300 hover:border-emerald-500/40"
                    >
                      {copiedHash === contentHash ? (
                        <Check className="size-3 shrink-0" />
                      ) : (
                        <Copy className="size-3 shrink-0" />
                      )}
                      <span>sha256:{contentHash}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
