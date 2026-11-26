#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

MODE="mock"
PORT=4321
NO_UI=0
FAST=0
AUTO=0
START_STEP=1
ASSUME_YES=0
LOG_PATH=""
NO_LOG=0
OPEN_BROWSER=0
CDP_PORT=9222

UI_PID=""
BROWSER_BIN=""
BROWSER_PID=""
CHROME_PROFILE_DIR=""
INIT_VIEW=""
REHEARSAL_FIXTURE=""
UI_LOG=""
CHECK_OUT=""
QUEUE_OUT=""
RELEASE_OUT=""
BEAT_EVENTS=""
CMD_EVENTS=""

RUN_START_MS=0
ACTIVE_BEAT_NUM=""
ACTIVE_BEAT_TITLE=""
ACTIVE_BEAT_TARGET=""
ACTIVE_BEAT_START_MS=0
MEM_ID=""
RECEIPT_SHA=""

usage() {
  cat <<'EOF'
Usage: scripts/demo-runner.sh [options]

Interactive 5-beat OBS demo runner for Meko Standards Guard.

Options:
  --mock              Zero-quota rehearsal mode using a temp copy of mock-datapack.json (default)
  --live              Live Meko mode (syncs CLI and guard:ui --mode live on the same datapack)
  --port <port>       Port for guard:ui server (default: 4321)
  --no-ui             Skip launching background guard:ui server
  --browser           Open clean Chrome window and run full CDP UI choreography
                      (auto-refresh, adaptive menu switching, filter clicks, smooth scroll, spotlighting)
  --cdp-port <port>   Local Chrome DevTools Protocol port for --browser (default: 9222)
  --fast              Print commands immediately without simulated typing
  --auto              Non-interactive auto-advance (allowed in --mock mode only)
  --step <1..5>       Start from a specific beat (1-5, default: 1)
  --log <path>        Custom path for generated timestamp & VO cue-sheet Markdown
  --no-log            Disable writing the timestamp & VO cue-sheet file
  --yes               Skip the --live confirmation prompt
  -h, --help          Show this help message and exit
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mock)
      MODE="mock"
      shift
      ;;
    --live)
      MODE="live"
      shift
      ;;
    --port)
      if [[ $# -lt 2 ]]; then
        echo "Error: --port requires a value." >&2
        exit 1
      fi
      PORT="$2"
      shift 2
      ;;
    --no-ui)
      NO_UI=1
      shift
      ;;
    --browser)
      OPEN_BROWSER=1
      shift
      ;;
    --cdp-port)
      if [[ $# -lt 2 ]]; then
        echo "Error: --cdp-port requires a value." >&2
        exit 1
      fi
      CDP_PORT="$2"
      shift 2
      ;;
    --fast)
      FAST=1
      shift
      ;;
    --auto)
      AUTO=1
      shift
      ;;
    --step)
      if [[ $# -lt 2 ]]; then
        echo "Error: --step requires a value (1..5)." >&2
        exit 1
      fi
      START_STEP="$2"
      shift 2
      ;;
    --log)
      if [[ $# -lt 2 ]]; then
        echo "Error: --log requires a file path." >&2
        exit 1
      fi
      LOG_PATH="$2"
      shift 2
      ;;
    --no-log)
      NO_LOG=1
      shift
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Error: Invalid --port value '$PORT'. Must be an integer between 1 and 65535." >&2
  exit 1
fi

if ! [[ "$CDP_PORT" =~ ^[0-9]+$ ]] || (( CDP_PORT < 1 || CDP_PORT > 65535 )); then
  echo "Error: Invalid --cdp-port value '$CDP_PORT'. Must be an integer between 1 and 65535." >&2
  exit 1
fi

if ! [[ "$START_STEP" =~ ^[1-5]$ ]]; then
  echo "Error: Invalid --step value '$START_STEP'. Must be 1, 2, 3, 4, or 5." >&2
  exit 1
fi

if [[ "$MODE" == "live" && "$AUTO" -eq 1 ]]; then
  echo "Error: --live cannot be combined with --auto to prevent accidental live Meko quota consumption." >&2
  exit 1
fi

if [[ "$NO_LOG" -eq 0 && -z "$LOG_PATH" ]]; then
  if [[ "$MODE" == "live" ]]; then
    if [[ -d "/home/rizalkurnia/Videos/meko-standards-guard-demo" || -d "/home/rizalkurnia/Videos" ]]; then
      LOG_PATH="/home/rizalkurnia/Videos/meko-standards-guard-demo/LIVE_TIMESTAMPS.md"
    else
      LOG_PATH="/tmp/meko-demo-timestamps-live.md"
    fi
  else
    LOG_PATH="/tmp/meko-demo-timestamps-mock.md"
  fi
fi

now_ms() {
  date +%s%3N
}

elapsed_ms() {
  if [[ "$RUN_START_MS" -eq 0 ]]; then
    echo 0
  else
    echo $(( $(now_ms) - RUN_START_MS ))
  fi
}

fmt_mmss() {
  local ms="$1"
  local total_sec=$(( ms / 1000 ))
  printf '%02d:%02d' $(( total_sec / 60 )) $(( total_sec % 60 ))
}

begin_beat() {
  local num="$1"
  local title="$2"
  local target_dur="$3"
  end_active_beat
  ACTIVE_BEAT_NUM="$num"
  ACTIVE_BEAT_TITLE="$title"
  ACTIVE_BEAT_TARGET="$target_dur"
  ACTIVE_BEAT_START_MS="$(elapsed_ms)"
}

end_active_beat() {
  if [[ -n "$ACTIVE_BEAT_NUM" && -n "$BEAT_EVENTS" ]]; then
    local end_ms
    end_ms="$(elapsed_ms)"
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "$ACTIVE_BEAT_NUM" "$ACTIVE_BEAT_TITLE" "$ACTIVE_BEAT_TARGET" "$ACTIVE_BEAT_START_MS" "$end_ms" >> "$BEAT_EVENTS"
    ACTIVE_BEAT_NUM=""
  fi
}

write_timestamp_report() {
  if [[ "$NO_LOG" -ne 0 || "$RUN_START_MS" -eq 0 || -z "$BEAT_EVENTS" || ! -s "$BEAT_EVENTS" ]]; then
    return 0
  fi

  end_active_beat
  mkdir -p "$(dirname "$LOG_PATH")"

  local total_ms
  total_ms="$(elapsed_ms)"
  local total_mmss
  total_mmss="$(fmt_mmss "$total_ms")"

  node - "$LOG_PATH" "$BEAT_EVENTS" "$CMD_EVENTS" "$MODE" "$START_STEP" "$total_ms" "$MEM_ID" "$RECEIPT_SHA" <<'NODE'
const fs = require("node:fs");

const [
  outPath,
  beatsPath,
  cmdsPath,
  mode,
  startStep,
  totalMsStr,
  memId,
  receiptSha
] = process.argv.slice(2);

const totalMs = Number(totalMsStr) || 0;
const ceilingMs = 270000; // 04:30 hard ceiling

function fmtMmSs(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function fmtSec(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

function fmtSrt(ms) {
  const clamped = Math.max(0, Math.round(ms));
  const h = String(Math.floor(clamped / 3600000)).padStart(2, "0");
  const m = String(Math.floor((clamped % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((clamped % 60000) / 1000)).padStart(2, "0");
  const rem = String(clamped % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${rem}`;
}

const VO_CUES = {
  "1": "AI coding agents start every session from zero. Standards memorized in Cursor never reach OpenCode or Claude Code, prose ADR files get ignored under long context, and letting agents write directly into shared memory risks context poisoning. Meko Standards Guard solves this with one YugabyteDB Meko datapack (`payledger-standards-guard`) using all five Meko primitives: Knowledge Base for 8 financial ADRs (`S1`–`S8`), 2-tier Private and Shared Memory for human-gated learnings, Conversations for audit logs, Content-Addressed Artifacts for release receipts, and Self-Learning signals.",
  "2": "Before writing a single line of code, `standards-guard spec-check` checks our draft refunds RFC against Meko ADRs and catches three invariant conflicts immediately—optional idempotency, mutating append-only `ledger_entries`, and returning raw merchant PII. `standards-guard impact ADR-003` shows the exact files, routes, and Vitest invariants in its blast radius.",
  "3": "When Cursor ignores the spec and writes a naive `POST /refunds` handler, our `ts-morph` AST and PII taint engine blocks it deterministically: missing idempotency (`S2`), float fee math (`S1`), direct `db.update(ledgerEntries)` (`S3`), and raw merchant PII in `c.json` (`S4`). Crucially, Standards Guard quarantines these findings in Cursor's private Meko memory (`memory_add`) so an unreviewed agent cannot poison team context. A human maintainer reviews the queue and runs `approve`, calling `memory_promote` and logging an audit message to Meko Conversations.",
  "4": "Now a fresh OpenCode session starts with zero chat history. Querying Meko via MCP returns the exact ADR chunk plus the newly promoted lesson. OpenCode implements `POST /refunds` using `requireIdempotency`, `multiplyBpsBankers`, `reverseLedgerGroup`, and `toPublicMerchantDto`—passing `guard check` on its very first try. Running `standards-guard release-gate` verifies all AST and SQLite ledger invariants and emits a SHA-256 compliance receipt artifact directly into Meko.",
  "5": "Across five representative PayLedger endpoints measured with `tiktoken`, replacing full-ADR prompting and retry loops with targeted Meko retrieval cut rule violations from 15 to zero, eliminated correction turns from 1.8 to zero, and reduced prompt tokens from 9,725 to 1,089—an 88.8% reduction. Every agent config, ADR, and test suite is open-source and runs offline in zero-key `--mode mock` with one command. One Meko datapack, every coding agent, zero drift."
};

const beats = fs
  .readFileSync(beatsPath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [num, title, target, startMs, endMs] = line.split("\t");
    return {
      num,
      title,
      target,
      startMs: Number(startMs),
      endMs: Number(endMs)
    };
  });

const cmds = fs.existsSync(cmdsPath)
  ? fs
      .readFileSync(cmdsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [beat, startMs, endMs, ...rest] = line.split("\t");
        return {
          beat,
          startMs: Number(startMs),
          endMs: Number(endMs),
          command: rest.join("\t")
        };
      })
  : [];

const ceilingStatus =
  totalMs <= ceilingMs ? "WITHIN 04:30 CEILING" : "OVER 04:30 CEILING";
const recordedAt = new Date().toISOString();

const lines = [];
lines.push("# Meko Standards Guard — Recorded Take Timestamps & VO Cue Sheet");
lines.push("");
lines.push(`- **Mode**: \`mode=${mode}\``);
lines.push(`- **Recorded At**: \`${recordedAt}\``);
lines.push(
  `- **Total Duration**: \`${fmtMmSs(totalMs)}\` (\`${fmtSec(totalMs)}\` — ${ceilingStatus})`
);
lines.push(`- **Approved MEM_ID**: \`${memId || "n/a"}\``);
lines.push(`- **Compliance Receipt SHA-256**: \`${receiptSha || "n/a"}\``);
lines.push(
  `- **Clock Anchor**: \`00:00\` starts when Enter was pressed to begin Beat ${startStep}.`
);
lines.push("");
lines.push("## Video Chapters (YouTube / HackerEarth)");
lines.push("");
for (const b of beats) {
  lines.push(`- \`${fmtMmSs(b.startMs)}\` Beat ${b.num} — ${b.title}`);
}
lines.push("");
lines.push("## Beat-by-Beat Timing & VO Cue Sheet");
lines.push("");
lines.push("| Beat | Start | End | Actual | Target | SRT Window |");
lines.push("| :---: | :---: | :---: | :---: | :---: | :--- |");
for (const b of beats) {
  const actualMs = Math.max(0, b.endMs - b.startMs);
  lines.push(
    `| Beat ${b.num} | \`${fmtMmSs(b.startMs)}\` | \`${fmtMmSs(b.endMs)}\` | \`${fmtMmSs(actualMs)}\` (${fmtSec(actualMs)}) | \`${b.target}\` | \`${fmtSrt(b.startMs)} --> ${fmtSrt(b.endMs)}\` |`
  );
}
lines.push("");
for (const b of beats) {
  lines.push(`### Beat ${b.num} — ${b.title}`);
  lines.push(`- **SRT Window**: \`${fmtSrt(b.startMs)} --> ${fmtSrt(b.endMs)}\``);
  if (b.num === "3" && memId) {
    lines.push(`- **Synced Take Highlight**: Approved \`${memId}\` (\`private -> shared\`)`);
  }
  if (b.num === "4" && receiptSha) {
    lines.push(`- **Synced Take Highlight**: Receipt SHA-256 \`${receiptSha}\``);
  }
  const vo = VO_CUES[b.num];
  if (vo) {
    lines.push(`- **VO Cue**:`);
    lines.push(`  > ${vo}`);
  }
  lines.push("");
}

lines.push("## Command Execution Log");
lines.push("");
lines.push("| Beat | Start | End | Exec | Command |");
lines.push("| :---: | :---: | :---: | :---: | :--- |");
for (const c of cmds) {
  const execMs = Math.max(0, c.endMs - c.startMs);
  const safeCmd = c.command.replace(/\|/g, "\\|");
  lines.push(
    `| Beat ${c.beat} | \`${fmtMmSs(c.startMs)}\` | \`${fmtMmSs(c.endMs)}\` | \`${fmtSec(execMs)}\` | \`${safeCmd}\` |`
  );
}
lines.push("");

fs.writeFileSync(outPath, `${lines.join("\n")}`, "utf8");
NODE

  echo "[demo-runner] Saved timestamp & VO cue sheet: ${LOG_PATH} (total ${total_mmss})"
}

cleanup() {
  local exit_code=$?
  write_timestamp_report || true
  if [[ -n "${BROWSER_PID}" ]] && kill -0 "${BROWSER_PID}" 2>/dev/null; then
    pkill -P "${BROWSER_PID}" 2>/dev/null || true
    kill "${BROWSER_PID}" 2>/dev/null || true
    wait "${BROWSER_PID}" 2>/dev/null || true
  fi
  if [[ -n "${UI_PID}" ]] && kill -0 "${UI_PID}" 2>/dev/null; then
    pkill -P "${UI_PID}" 2>/dev/null || true
    kill "${UI_PID}" 2>/dev/null || true
    wait "${UI_PID}" 2>/dev/null || true
  fi
  if [[ -n "${CHROME_PROFILE_DIR}" ]]; then
    rm -rf "${CHROME_PROFILE_DIR}"
  fi
  rm -f "${REHEARSAL_FIXTURE}" "${UI_LOG}" "${CHECK_OUT}" "${QUEUE_OUT}" "${RELEASE_OUT}" "${BEAT_EVENTS}" "${CMD_EVENTS}"
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

has_live_token() {
  if [[ -n "${MEKO_API_TOKEN:-}" ]]; then
    return 0
  fi
  if [[ -f "${REPO_ROOT}/.env" ]]; then
    local token_line
    token_line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?MEKO_API_TOKEN=' "${REPO_ROOT}/.env" | tail -n 1 || true)"
    if [[ -n "$token_line" ]]; then
      local val="${token_line#*=}"
      val="${val%%#*}"
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
      val="$(printf '%s' "$val" | tr -d '[:space:]')"
      if [[ -n "$val" ]]; then
        return 0
      fi
    fi
  fi
  return 1
}

if [[ "$MODE" == "live" ]]; then
  if ! has_live_token; then
    echo "Error: MEKO_API_TOKEN is missing or empty in environment and ${REPO_ROOT}/.env." >&2
    exit 1
  fi
  if [[ "$ASSUME_YES" -eq 0 ]]; then
    printf "Live Meko mode will call the live datapack and consume quota. Continue? [y/N] "
    read -r confirm_live
    if ! [[ "$confirm_live" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  fi
fi

UI_LOG="/tmp/meko-demo-ui-$$.log"
CHECK_OUT="/tmp/meko-demo-check-$$.out"
QUEUE_OUT="/tmp/meko-demo-queue-$$.out"
RELEASE_OUT="/tmp/meko-demo-release-$$.out"
BEAT_EVENTS="/tmp/meko-demo-beats-$$.tsv"
CMD_EVENTS="/tmp/meko-demo-cmds-$$.tsv"
: > "$BEAT_EVENTS"
: > "$CMD_EVENTS"

if [[ "$MODE" == "mock" ]]; then
  REHEARSAL_FIXTURE="/tmp/meko-demo-rehearsal-$$.json"
  if [[ ! -f "${REPO_ROOT}/fixtures/meko/mock-datapack.json" ]]; then
    echo "Error: Missing ${REPO_ROOT}/fixtures/meko/mock-datapack.json" >&2
    exit 1
  fi
  cp "${REPO_ROOT}/fixtures/meko/mock-datapack.json" "${REHEARSAL_FIXTURE}"
  MODE_ARGS=(--mode mock --fixture "${REHEARSAL_FIXTURE}")
else
  MODE_ARGS=(--mode live)
fi

if [[ "$NO_UI" -eq 0 ]]; then
  if [[ ! -f "${REPO_ROOT}/packages/guard-ui/dist/client/index.html" ]]; then
    echo "Error: Missing packages/guard-ui/dist/client/index.html. Run 'npm run build' first." >&2
    exit 1
  fi
  if [[ ! -x "${REPO_ROOT}/node_modules/.bin/tsx" ]]; then
    echo "Error: Missing ${REPO_ROOT}/node_modules/.bin/tsx. Run 'npm install' first." >&2
    exit 1
  fi
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "Error: A server is already responding on http://127.0.0.1:${PORT}/api/health. Stop it first or pass --port / --no-ui." >&2
    exit 1
  fi

  UI_CMD=("${REPO_ROOT}/node_modules/.bin/tsx" "packages/guard-ui/server/index.ts" "${MODE_ARGS[@]}" "--port" "${PORT}")
  "${UI_CMD[@]}" >"${UI_LOG}" 2>&1 &
  UI_PID=$!

  UI_READY=0
  for _ in $(seq 1 50); do
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      UI_READY=1
      break
    fi
    if ! kill -0 "${UI_PID}" 2>/dev/null; then
      break
    fi
    sleep 0.3
  done

  if [[ "$UI_READY" -ne 1 ]]; then
    echo "Error: guard:ui failed to become healthy on http://127.0.0.1:${PORT}" >&2
    if [[ -f "${UI_LOG}" ]]; then
      echo "--- guard:ui log (last 20 lines) ---" >&2
      tail -n 20 "${UI_LOG}" >&2 || true
    fi
    exit 1
  fi
fi

detect_browser_bin() {
  local candidate
  for candidate in google-chrome chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

initial_view_for_step() {
  case "$1" in
    1|2) echo "blast" ;;
    3) echo "queue" ;;
    4) echo "timeline" ;;
    5) echo "benchmark" ;;
    *) echo "blast" ;;
  esac
}

browser_action() {
  local action="$1"
  local arg1="${2:-}"
  if [[ "$OPEN_BROWSER" -ne 1 ]]; then
    return 0
  fi

  local origin="http://127.0.0.1:${PORT}"
  local fast_flag="false"
  if [[ "$FAST" -eq 1 ]]; then
    fast_flag="true"
  fi

  node - "$CDP_PORT" "$origin" "$action" "$arg1" "$fast_flag" <<'NODE' || true
const [cdpPort, origin, action, arg1, fastStr] = process.argv.slice(2);
const fast = fastStr === "true";

const expr = `
(async () => {
  const action = ${JSON.stringify(action)};
  const arg1 = ${JSON.stringify(arg1)};
  const fast = ${fast ? "true" : "false"};
  const origin = ${JSON.stringify(origin)};

  const sleep = (ms) => new Promise((r) => setTimeout(r, fast ? Math.min(ms, 120) : ms));
  const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();

  function isVisible(el) {
    if (!el || el.offsetParent === null) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function findButton(label, root = document) {
    const target = label.toLowerCase();
    const buttons = Array.from(root.querySelectorAll("button")).filter(isVisible);
    return (
      buttons.find((b) => norm(b.textContent).toLowerCase() === target) ||
      buttons.find((b) => norm(b.textContent).toLowerCase().startsWith(target)) ||
      buttons.find((b) => norm(b.textContent).toLowerCase().includes(target)) ||
      null
    );
  }

  async function spotlight(el, holdMs = 700) {
    if (!el) return false;
    el.scrollIntoView({ behavior: fast ? "auto" : "smooth", block: "center" });
    await sleep(fast ? 80 : 320);
    const prevShadow = el.style.boxShadow;
    const prevTransition = el.style.transition;
    el.style.transition = "box-shadow 250ms ease";
    el.style.boxShadow = "0 0 0 2px #38bdf8, 0 0 22px rgba(56, 189, 248, 0.35)";
    await sleep(holdMs);
    el.style.boxShadow = prevShadow;
    el.style.transition = prevTransition;
    return true;
  }

  async function scrollToTop() {
    window.scrollTo({ top: 0, behavior: fast ? "auto" : "smooth" });
    await sleep(fast ? 80 : 320);
  }

  async function waitForLoaded(maxMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const btn = findButton("Refresh");
      if (btn && !btn.disabled) return true;
      await sleep(100);
    }
    return false;
  }

  async function clickRefresh() {
    await waitForLoaded();
    const btn = findButton("Refresh");
    if (!btn) return false;
    await spotlight(btn, 220);
    btn.click();
    await sleep(180);
    await waitForLoaded();
    await sleep(250);
    return true;
  }

  async function clickNav(label, viewSlug) {
    let navMode = "sidebar";
    const sidebarNav = document.querySelector("aside nav");
    let btn = sidebarNav ? findButton(label, sidebarNav) : null;

    if (!btn) {
      navMode = "drawer";
      const toggle = document.querySelector('button[aria-label="Toggle navigation"]');
      if (toggle && isVisible(toggle)) {
        const mobileNavBefore = Array.from(document.querySelectorAll("header + div nav")).find(isVisible);
        if (!mobileNavBefore) {
          toggle.click();
          await sleep(300);
        }
        const mobileNav = Array.from(document.querySelectorAll("header + div nav")).find(isVisible) || document;
        btn = findButton(label, mobileNav);
      }
    }

    if (!btn) {
      btn = findButton(label);
    }

    if (btn) {
      await spotlight(btn, 200);
      btn.click();
      await sleep(350);
      return { ok: true, navMode };
    }

    window.location.href = origin + "/?view=" + encodeURIComponent(viewSlug);
    return { ok: false, navMode: "fallback" };
  }

  function findCardContaining(needle, selector = ".rounded-lg, .p-4") {
    if (!needle) return null;
    const lower = needle.toLowerCase();
    const candidates = Array.from(document.querySelectorAll(selector)).filter((el) =>
      isVisible(el) && norm(el.textContent).toLowerCase().includes(lower)
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
    return candidates[0];
  }

  async function waitForCardContaining(needle, selector = ".rounded-lg, .p-4", maxMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const found = findCardContaining(needle, selector);
      if (found) return found;
      await sleep(120);
    }
    return null;
  }

  const currentView = new URLSearchParams(window.location.search).get("view") || "queue";
  let detail = { currentView };

  if (action === "beat1_overview") {
    await waitForLoaded();
    await scrollToTop();
    const kpi = document.querySelector("main .grid") || document.querySelector("main > div");
    detail.highlighted = await spotlight(kpi, 700);
  } else if (action === "beat2a_spec") {
    if (currentView !== "blast") {
      detail.nav = await clickNav("ADR Blast Radius", "blast");
    }
    const specSection = await waitForCardContaining("Pre-Implementation Spec Gate", "section", 4000);
    await waitForCardContaining("CONFLICTS", "section", 4000) || await waitForCardContaining("SPEC PASS", "section", 1000);
    detail.highlighted = await spotlight(specSection, 900);
  } else if (action === "beat2b_blast") {
    if ((new URLSearchParams(window.location.search).get("view") || "queue") !== "blast") {
      detail.nav = await clickNav("ADR Blast Radius", "blast");
    }
    await scrollToTop();
    await sleep(300);
    const s2Btn = findButton("S2 · ADR-002");
    if (s2Btn) {
      s2Btn.click();
      await sleep(550);
    }
    const s3Btn = findButton("S3 · ADR-003");
    if (s3Btn) {
      await spotlight(s3Btn, 250);
      s3Btn.click();
      await sleep(450);
    }
    const blastCard = await waitForCardContaining("Files (", ".rounded-lg", 3000);
    detail.highlighted = await spotlight(blastCard, 800);
  } else if (action === "beat3b_queue") {
    detail.refreshed = await clickRefresh();
    detail.nav = await clickNav("Approval Queue", "queue");
    let card = arg1 ? await waitForCardContaining(arg1, ".rounded-lg", 2500) : null;
    detail.matchedMemId = Boolean(card);
    if (!card) {
      card = findCardContaining("Pending Private Quarantine", "section, .rounded-lg");
    }
    detail.highlighted = await spotlight(card, 1000);
  } else if (action === "beat3c_timeline") {
    detail.refreshed = await clickRefresh();
    await sleep(400);
    detail.nav = await clickNav("Cross-Agent Timeline", "timeline");
    const sharedBtn = findButton("Shared");
    if (sharedBtn) {
      sharedBtn.click();
      await sleep(850);
      const sharedCard =
        (arg1 && findCardContaining(arg1, ".divide-y > div, .p-4")) ||
        document.querySelector("main .divide-y > div");
      detail.sharedHighlighted = await spotlight(sharedCard, 500);
    }
    const convBtn = findButton("Conversations");
    if (convBtn) {
      convBtn.click();
      await sleep(850);
      const convCard = document.querySelector("main .divide-y > div");
      detail.convHighlighted = await spotlight(convCard, 500);
    }
    const allBtn = findButton("All Primitives");
    if (allBtn) {
      allBtn.click();
      await sleep(350);
    }
    await scrollToTop();
  } else if (action === "beat4a_opencode") {
    detail.refreshed = await clickRefresh();
    if ((new URLSearchParams(window.location.search).get("view") || "queue") !== "timeline") {
      detail.nav = await clickNav("Cross-Agent Timeline", "timeline");
    }
    const slBtn = findButton("Self-Learning");
    if (slBtn) {
      slBtn.click();
      await sleep(450);
    }
    let card = await waitForCardContaining("opencode", ".divide-y > div, .p-4", 2500);
    detail.matchedOpencode = Boolean(card);
    if (!card) {
      card = document.querySelector("main .divide-y > div");
    }
    detail.highlighted = await spotlight(card, 1000);
  } else if (action === "beat4b_receipt") {
    detail.refreshed = await clickRefresh();
    if ((new URLSearchParams(window.location.search).get("view") || "queue") !== "timeline") {
      detail.nav = await clickNav("Cross-Agent Timeline", "timeline");
    }
    const artBtn = findButton("Artifacts");
    if (artBtn) {
      artBtn.click();
      await sleep(450);
    }
    let card = arg1 ? await waitForCardContaining(arg1, ".divide-y > div, .p-4", 2500) : null;
    detail.matchedReceipt = Boolean(card);
    if (!card) {
      card = findCardContaining("sha256:", ".divide-y > div, .p-4") || document.querySelector("main .divide-y > div");
    }
    detail.highlighted = await spotlight(card, 1000);
  } else if (action === "beat5_benchmark") {
    detail.nav = await clickNav("A/B Benchmark", "benchmark");
    await scrollToTop();
    await sleep(500);
    const summaryGrid = findCardContaining("Total Rule Violations", ".grid");
    detail.summaryHighlighted = await spotlight(summaryGrid, 850);
    const tableEl = document.querySelector("table");
    detail.tableHighlighted = await spotlight(tableEl, 850);
  } else {
    return { ok: false, action, error: "unknown_action" };
  }

  return { ok: true, action, detail };
})()
`;

async function run() {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  if (!res.ok) return;
  const targets = await res.json();
  const page =
    targets.find(
      (t) =>
        t.type === "page" &&
        t.webSocketDebuggerUrl &&
        String(t.url || "").startsWith(origin)
    ) || targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);

  if (!page) return;

  await new Promise((resolve) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve();
    }, 20000);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: expr,
            awaitPromise: true,
            returnByValue: true
          }
        })
      );
    });

    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === 1) {
          if (process.env.DEMO_CDP_DEBUG === "1") {
            const payload = msg.result?.result?.value ?? msg.error ?? { ok: false };
            console.log(`[cdp] ${action} -> ${JSON.stringify(payload)}`);
          }
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      } catch {}
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

run().catch(() => {});
NODE
}

if [[ "$OPEN_BROWSER" -eq 1 ]]; then
  if ! BROWSER_BIN="$(detect_browser_bin)"; then
    echo "Error: Could not find google-chrome, chromium, or chromium-browser in PATH." >&2
    exit 1
  fi
  if curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo "Error: Chrome DevTools Protocol is already responding on port ${CDP_PORT}. Pass --cdp-port <port>." >&2
    exit 1
  fi

  CHROME_PROFILE_DIR="/tmp/meko-demo-chrome-$$"
  mkdir -p "${CHROME_PROFILE_DIR}"
  INIT_VIEW="$(initial_view_for_step "${START_STEP}")"

  CHROME_CMD=(
    "${BROWSER_BIN}"
    "--remote-debugging-port=${CDP_PORT}"
    "--user-data-dir=${CHROME_PROFILE_DIR}"
    "--no-first-run"
    "--no-default-browser-check"
    "--disable-session-crashed-bubble"
    "--new-window"
  )
  if [[ -n "${DEMO_CHROME_WINDOW_SIZE:-}" ]]; then
    CHROME_CMD+=("--window-size=${DEMO_CHROME_WINDOW_SIZE}")
  fi
  if [[ "${DEMO_CHROME_HEADLESS:-0}" == "1" ]]; then
    CHROME_CMD+=("--headless=new" "--disable-gpu")
  fi
  CHROME_CMD+=("http://127.0.0.1:${PORT}/?view=${INIT_VIEW}")

  "${CHROME_CMD[@]}" >"/dev/null" 2>&1 &
  BROWSER_PID=$!

  CDP_READY=0
  for _ in $(seq 1 50); do
    if node -e '
      fetch(`http://127.0.0.1:${process.argv[1]}/json/list`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list) => {
          const ok = Array.isArray(list) && list.some((t) => t.type === "page" && t.webSocketDebuggerUrl);
          process.exit(ok ? 0 : 1);
        })
        .catch(() => process.exit(1));
    ' "${CDP_PORT}" >/dev/null 2>&1; then
      CDP_READY=1
      break
    fi
    if ! kill -0 "${BROWSER_PID}" 2>/dev/null; then
      break
    fi
    sleep 0.3
  done

  if [[ "$CDP_READY" -ne 1 ]]; then
    echo "Error: Chrome CDP failed to become ready on port ${CDP_PORT}." >&2
    exit 1
  fi
fi

clear_screen() {
  if [[ -t 1 && "${TERM:-dumb}" != "dumb" ]]; then
    clear 2>/dev/null || printf '\033[2J\033[H'
  fi
}

wait_next() {
  local label="$1"
  local target_cum="${2:-}"
  if [[ "$AUTO" -eq 1 ]]; then
    return 0
  fi

  local prefix=""
  if [[ "$RUN_START_MS" -gt 0 ]]; then
    local el
    el="$(fmt_mmss "$(elapsed_ms)")"
    if [[ -n "$target_cum" ]]; then
      prefix="${el} / target ${target_cum} | "
    else
      prefix="${el} | "
    fi
  fi

  if [[ -t 1 ]]; then
    printf '\033[2m[%sEnter: %s | q: quit] \033[0m' "$prefix" "$label"
  else
    printf '[%sEnter: %s | q: quit] ' "$prefix" "$label"
  fi
  local choice=""
  read -r choice
  if [[ "$choice" == "q" || "$choice" == "Q" ]]; then
    exit 0
  fi
  if [[ -t 1 ]]; then
    printf '\033[1A\033[2K'
  fi
}

format_cmd_display() {
  local out=""
  local arg
  for arg in "$@"; do
    if [[ "$arg" =~ [[:space:]\"\'] ]]; then
      out+="$(printf '%q' "$arg") "
    else
      out+="${arg} "
    fi
  done
  printf '%s' "${out% }"
}

print_cmd() {
  local cmd_text="$1"
  if [[ -t 1 ]]; then
    printf '\033[1;32m$\033[0m '
  else
    printf '$ '
  fi

  if [[ "$FAST" -eq 1 || ! -t 1 ]]; then
    printf '%s\n' "$cmd_text"
    return 0
  fi

  local i len ch
  len=${#cmd_text}
  for (( i = 0; i < len; i += 1 )); do
    ch="${cmd_text:i:1}"
    printf '%s' "$ch"
    sleep 0.02
  done
  printf '\n'
}

record_cmd_event() {
  local cmd_start_ms="$1"
  local cmd_end_ms="$2"
  local display="$3"
  if [[ -n "$CMD_EVENTS" ]]; then
    printf '%s\t%s\t%s\t%s\n' "${ACTIVE_BEAT_NUM:-0}" "$cmd_start_ms" "$cmd_end_ms" "$display" >> "$CMD_EVENTS"
  fi
}

run_cmd() {
  local allow_fail="$1"
  shift
  local display
  display="$(format_cmd_display "$@")"
  print_cmd "$display"
  local cmd_start_ms
  cmd_start_ms="$(elapsed_ms)"
  if "$@"; then
    record_cmd_event "$cmd_start_ms" "$(elapsed_ms)" "$display"
    return 0
  else
    local rc=$?
    record_cmd_event "$cmd_start_ms" "$(elapsed_ms)" "$display"
    if [[ "$allow_fail" -eq 1 ]]; then
      return 0
    fi
    return "$rc"
  fi
}

run_cmd_tee() {
  local allow_fail="$1"
  local out_file="$2"
  shift 2
  local display
  display="$(format_cmd_display "$@")"
  print_cmd "$display"
  local cmd_start_ms
  cmd_start_ms="$(elapsed_ms)"
  if "$@" 2>&1 | tee "$out_file"; then
    record_cmd_event "$cmd_start_ms" "$(elapsed_ms)" "$display"
    return 0
  else
    local rc=$?
    record_cmd_event "$cmd_start_ms" "$(elapsed_ms)" "$display"
    if [[ "$allow_fail" -eq 1 ]]; then
      return 0
    fi
    return "$rc"
  fi
}

extract_mem_id_from_check() {
  local file_path="$1"
  node -e '
    const fs = require("node:fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const m = text.match(/Quarantined\s+\d+\s+private candidate memory item\(s\) for agent "cursor":\s*([^\s,]+)/);
    if (m && m[1]) process.stdout.write(m[1]);
  ' "$file_path"
}

extract_mem_id_from_queue() {
  local file_path="$1"
  node -e '
    const fs = require("node:fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const m = text.match(/^\s*-\s+([^\s]+)\s+\[/m);
    if (m && m[1]) process.stdout.write(m[1]);
  ' "$file_path"
}

extract_receipt_sha() {
  local file_path="$1"
  node -e '
    const fs = require("node:fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const m = text.match(/Compliance Receipt SHA-256:\s*([a-f0-9]+)/i);
    if (m && m[1]) process.stdout.write(m[1]);
  ' "$file_path"
}

# Pre-flight summary (cleared as soon as the first beat begins)
clear_screen
echo "=== Meko Standards Guard — OBS Demo Runner ==="
echo "Mode     : ${MODE}"
if [[ "$MODE" == "mock" ]]; then
  echo "Fixture  : ${REHEARSAL_FIXTURE} (copy of mock-datapack.json)"
fi
if [[ "$NO_UI" -eq 0 ]]; then
  echo "guard:ui : http://127.0.0.1:${PORT} (healthy, mode=${MODE})"
else
  echo "guard:ui : skipped (--no-ui)"
fi
if [[ "$OPEN_BROWSER" -eq 1 ]]; then
  echo "Browser  : ${BROWSER_BIN} (hands-free CDP choreography on port ${CDP_PORT}, initial ?view=${INIT_VIEW})"
else
  echo ""
  echo "Open these browser tabs BEFORE starting OBS recording:"
  echo "  1. http://127.0.0.1:${PORT}/?view=blast"
  echo "  2. http://127.0.0.1:${PORT}/?view=queue"
  echo "  3. http://127.0.0.1:${PORT}/?view=timeline"
  echo "  4. http://127.0.0.1:${PORT}/?view=benchmark"
  echo "Tip: pass --browser to auto-open Chrome and run hands-free CDP UI choreography."
fi
if [[ "$NO_LOG" -eq 0 ]]; then
  echo "Log Out  : ${LOG_PATH}"
fi
echo ""
if [[ "$OPEN_BROWSER" -eq 1 ]]; then
  echo "Snap Terminal left (Super+Left) and Browser right (Super+Right), start OBS recording, then just press Enter at each step."
else
  echo "Start OBS recording, then press Enter to clear screen and start Beat ${START_STEP}/5."
fi
wait_next "Start Beat ${START_STEP}/5"

RUN_START_MS="$(now_ms)"

# Beat 1 — Problem & 5-Primitive Meko Architecture
if (( START_STEP <= 1 )); then
  begin_beat 1 "Problem & 5-Primitive Meko Architecture" "00:40"
  clear_screen
  run_cmd 0 npm run guard:status -- "${MODE_ARGS[@]}"
  browser_action beat1_overview
  wait_next "Beat 2/5: Pre-Implementation Spec Gate & Blast Radius" "00:40"
  end_active_beat
fi

# Beat 2 — Pre-Implementation Spec Gate & ADR-003 Blast Radius
if (( START_STEP <= 2 )); then
  begin_beat 2 "Pre-Implementation Spec Gate & ADR-003 Blast Radius" "00:45"
  clear_screen
  run_cmd 1 npm run guard:spec-check -- specs/001-refunds-rfc.md "${MODE_ARGS[@]}"
  browser_action beat2a_spec
  wait_next "Beat 2b: ADR-003 Blast Radius" "01:05"
  run_cmd 0 npm run guard:impact -- ADR-003
  browser_action beat2b_blast
  wait_next "Blast Radius ?view=blast -> Enter for Beat 3/5" "01:25"
  end_active_beat
fi

# Beat 3 — Agent A (Cursor) Blocked -> Queue -> Human Gate (memory_promote)
if (( START_STEP <= 3 )); then
  begin_beat 3 "Agent A (Cursor) Blocked -> Human Gate (memory_promote)" "01:10"
  clear_screen
  run_cmd_tee 1 "${CHECK_OUT}" npm run guard:check -- --agent cursor --files fixtures/benchmark/runs/t1-baseline-cursor.ts "${MODE_ARGS[@]}"
  MEM_ID="$(extract_mem_id_from_check "${CHECK_OUT}")"
  wait_next "Beat 3b: Inspect Private Approval Queue" "01:50"
  run_cmd_tee 0 "${QUEUE_OUT}" npm run guard:queue -- "${MODE_ARGS[@]}"
  if [[ -z "${MEM_ID}" ]]; then
    MEM_ID="$(extract_mem_id_from_queue "${QUEUE_OUT}")"
  fi
  if [[ -z "${MEM_ID}" ]]; then
    if [[ "$AUTO" -eq 1 ]]; then
      echo "Error: Could not extract a candidate Memory ID from guard:check or guard:queue output." >&2
      exit 1
    fi
    printf "Could not auto-detect Memory ID. Enter Memory ID to approve: "
    read -r MEM_ID
    if [[ -z "${MEM_ID}" ]]; then
      echo "Error: Empty Memory ID." >&2
      exit 1
    fi
  fi
  browser_action beat3b_queue "${MEM_ID}"
  wait_next "Beat 3c: Approve ${MEM_ID} (memory_promote -> shared)" "02:10"
  run_cmd 0 npm run guard:approve -- "${MEM_ID}" --reason "Verified ADR-002/003/004 refund safeguards" --by rizal "${MODE_ARGS[@]}"
  browser_action beat3c_timeline "${MEM_ID}"
  wait_next "Timeline ?view=timeline (ID ${MEM_ID} synced) -> Beat 4/5" "02:35"
  end_active_beat
fi

# Beat 4 — Agent B (OpenCode) Vaccinated First-Try Pass & Release Gate
if (( START_STEP <= 4 )); then
  begin_beat 4 "Agent B (OpenCode) Vaccinated First-Try Pass & Release Gate" "01:00"
  clear_screen
  run_cmd 0 npm run guard:check -- --agent opencode --files fixtures/benchmark/runs/t1-guarded-opencode.ts --record-fix "${MODE_ARGS[@]}"
  browser_action beat4a_opencode
  wait_next "Beat 4b: Run Release Gate & Emit SHA-256 Receipt" "03:05"
  run_cmd_tee 0 "${RELEASE_OUT}" npm run guard:release-gate -- "${MODE_ARGS[@]}"
  RECEIPT_SHA="$(extract_receipt_sha "${RELEASE_OUT}")"
  browser_action beat4b_receipt "${RECEIPT_SHA}"
  wait_next "Beat 5/5: Show A/B Benchmark & Closing" "03:35"
  end_active_beat
fi

# Beat 5 — A/B Benchmark Results & Offline Quickstart CTA (zero extra Meko calls)
if (( START_STEP <= 5 )); then
  begin_beat 5 "A/B Benchmark Results & Offline Quickstart CTA" "00:45"
  browser_action beat5_benchmark
  if [[ "$START_STEP" -eq 5 ]]; then
    clear_screen
    if [[ "$NO_UI" -eq 0 ]]; then
      echo "Benchmark UI: http://127.0.0.1:${PORT}/?view=benchmark"
    fi
    echo "Show Benchmark UI & README.md Quickstart."
  fi
  wait_next "Stop guard:ui and finish demo" "04:15"
  end_active_beat
fi
