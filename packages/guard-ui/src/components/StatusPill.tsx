export type PillTone = "emerald" | "amber" | "rose" | "sky" | "neutral";

const TONE_CLASSES: Record<PillTone, { wrapper: string; dot: string }> = {
  emerald: {
    wrapper: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    dot: "bg-emerald-400"
  },
  amber: {
    wrapper: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400"
  },
  rose: {
    wrapper: "border-rose-500/25 bg-rose-500/10 text-rose-300",
    dot: "bg-rose-400"
  },
  sky: {
    wrapper: "border-sky-500/25 bg-sky-500/10 text-sky-300",
    dot: "bg-sky-400"
  },
  neutral: {
    wrapper: "border-white/10 bg-white/5 text-slate-300",
    dot: "bg-slate-400"
  }
};

export function StatusPill({
  label,
  tone = "neutral",
  mono = false
}: {
  label: string;
  tone?: PillTone;
  mono?: boolean;
}) {
  const styles = TONE_CLASSES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${styles.wrapper} ${mono ? "font-mono tabular-nums" : ""}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${styles.dot}`} />
      <span>{label}</span>
    </span>
  );
}
