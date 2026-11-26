import { BookOpen, FileCheck2, ShieldAlert, Users } from "lucide-react";
import type { OverviewResponse } from "../lib/types";
import { StatusPill } from "./StatusPill";

export function KpiStrip({
  overview,
  loading
}: {
  overview: OverviewResponse | null;
  loading: boolean;
}) {
  if (loading && !overview) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="h-24 animate-pulse rounded-lg border border-white/10 bg-[#101318] p-4"
          >
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="mt-3 h-7 w-14 rounded bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  const counts = overview?.counts ?? {
    knowledge: 0,
    privateMemories: 0,
    sharedMemories: 0,
    conversations: 0,
    artifacts: 0,
    selfLearning: 0
  };

  const pendingTone = counts.privateMemories > 0 ? "amber" : "emerald";
  const latestHash = overview?.latestReceipt?.contentHash
    ? `sha256:${overview.latestReceipt.contentHash.slice(0, 10)}...`
    : "No release receipt yet";

  const cards = [
    {
      label: "Knowledge ADRs",
      value: counts.knowledge,
      meta: `${overview?.rules.length ?? 8} active guard rules`,
      icon: BookOpen,
      pill: <StatusPill label="Indexed KB" tone="sky" />
    },
    {
      label: "Approval Queue",
      value: counts.privateMemories,
      meta: "Quarantined private learnings",
      icon: ShieldAlert,
      pill: (
        <StatusPill
          label={counts.privateMemories > 0 ? "Review Due" : "Queue Clear"}
          tone={pendingTone}
        />
      )
    },
    {
      label: "Shared Memory",
      value: counts.sharedMemories,
      meta: `${counts.selfLearning} self-learning signals`,
      icon: Users,
      pill: <StatusPill label="Cross-Agent" tone="emerald" />
    },
    {
      label: "Audit & Receipts",
      value: counts.artifacts + counts.conversations,
      meta: latestHash,
      icon: FileCheck2,
      pill: <StatusPill label={`${counts.artifacts} artifacts`} tone="neutral" mono />
    }
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="rounded-lg border border-white/10 bg-[#101318] p-4 transition-colors hover:border-white/15"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#8B949E]">{card.label}</span>
              <Icon className="size-4 shrink-0 text-[#8B949E]" />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="font-mono text-2xl font-semibold tracking-tight text-[#E6EDF3] tabular-nums">
                {card.value}
              </span>
              {card.pill}
            </div>
            <p className="mt-1.5 truncate font-mono text-[11px] text-[#8B949E] tabular-nums">
              {card.meta}
            </p>
          </div>
        );
      })}
    </div>
  );
}
