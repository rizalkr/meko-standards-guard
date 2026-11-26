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
HANDSFREE=0
SKIP_AGENT_MCP=0
SKIP_AGENT_PROMPTS=0
OPENCODE_MODEL="${DEMO_OPENCODE_MODEL:-deepseek/deepseek-flash}"
AGENT_TIMEOUT="${DEMO_AGENT_TIMEOUT:-28}"
CURSOR_LOGGED_IN=0
TYPING_WPM=51
TYPING_ACCURACY=86
STEP_START_MS=0
START_STEP=1
ASSUME_YES=0
LOG_PATH=""
NO_LOG=0
OPEN_BROWSER=0
CDP_PORT=9222

UI_PID=""
CURSOR_AGENT_BIN=""
OPENCODE_BIN=""
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
REPORT_WRITTEN=0
FINAL_TOTAL_MMSS=""

usage() {
  cat <<'EOF'
Usage: scripts/demo-runner.sh [options]

Interactive 5-beat OBS demo runner for Meko Standards Guard.

Options:
  --mock              Zero-quota rehearsal mode using a temp copy of mock-datapack.json (default)
  --live              Live Meko mode (syncs CLI and guard:ui --mode live on the same datapack)
  --port <port>       Port for guard:ui server (default: 4321)
  --no-ui             Skip launching background guard:ui server
  --no-agent-mcp      Skip live cursor-agent / opencode MCP verification in Beat 1
  --no-agent-prompts  Skip live cursor-agent -p / opencode run MCP prompts in Beats 3-4
  --browser           Open clean Chrome window and run full CDP UI choreography
                      (auto-refresh, adaptive menu switching, filter clicks, smooth scroll, spotlighting)
  --cdp-port <port>   Local Chrome DevTools Protocol port for --browser (default: 9222)
  --fast              Print commands immediately without simulated typing
  --wpm <15..200>     Human typing speed in net WPM (default: 51)
  --accuracy <50..100> Human typing accuracy percentage with realistic typos/backspace (default: 86)
  --auto              Non-interactive auto-advance (allowed in --mock mode only)
  --handsfree         1-Enter OBS autopilot: pause once at start (and once after Beat 5),
                      then auto-run all 5 beats with VO-paced dwell pauses (works in --mock & --live)
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
    --no-agent-mcp)
      SKIP_AGENT_MCP=1
      shift
      ;;
    --no-agent-prompts)
      SKIP_AGENT_PROMPTS=1
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
    --wpm)
      if [[ $# -lt 2 ]]; then
        echo "Error: --wpm requires a value." >&2
        exit 1
      fi
      TYPING_WPM="$2"
      shift 2
      ;;
    --accuracy)
      if [[ $# -lt 2 ]]; then
        echo "Error: --accuracy requires a value." >&2
        exit 1
      fi
      TYPING_ACCURACY="$2"
      shift 2
      ;;
    --auto)
      AUTO=1
      shift
      ;;
    --handsfree)
      HANDSFREE=1
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

if ! [[ "$TYPING_WPM" =~ ^[0-9]+$ ]] || (( TYPING_WPM < 15 || TYPING_WPM > 200 )); then
  echo "Error: Invalid --wpm value '$TYPING_WPM'. Must be an integer between 15 and 200." >&2
  exit 1
fi

if ! [[ "$TYPING_ACCURACY" =~ ^[0-9]+$ ]] || (( TYPING_ACCURACY < 50 || TYPING_ACCURACY > 100 )); then
  echo "Error: Invalid --accuracy value '$TYPING_ACCURACY'. Must be an integer between 50 and 100." >&2
  exit 1
fi

if ! [[ "$AGENT_TIMEOUT" =~ ^[0-9]+$ ]] || (( AGENT_TIMEOUT < 5 || AGENT_TIMEOUT > 120 )); then
  echo "Error: Invalid DEMO_AGENT_TIMEOUT value '$AGENT_TIMEOUT'. Must be an integer between 5 and 120." >&2
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
  local quiet="${1:-0}"
  if [[ "$REPORT_WRITTEN" -eq 1 || "$NO_LOG" -ne 0 || "$RUN_START_MS" -eq 0 || -z "$BEAT_EVENTS" || ! -s "$BEAT_EVENTS" ]]; then
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
  "1": "AI coding agents start every session from zero. Standards memorized in Cursor never reach OpenCode or Claude Code, prose ADR files get ignored under long context, and letting agents write directly into shared memory risks context poisoning. Meko Standards Guard solves this with one YugabyteDB Meko datapack (`payledger-standards-guard`) wired live over MCP to both Cursor and OpenCode—combining all five Meko primitives: Knowledge Base for 8 financial ADRs (`S1`–`S8`), 2-tier Private and Shared Memory for human-gated learnings, Conversations for audit logs, Content-Addressed Artifacts for release receipts, and Self-Learning signals.",
  "2": "Before writing a single line of code, `standards-guard spec-check` checks our draft refunds RFC against Meko ADRs and catches three invariant conflicts immediately—optional idempotency, mutating append-only `ledger_entries`, and returning raw merchant PII. `standards-guard impact ADR-003` shows the exact files, routes, and Vitest invariants in its blast radius.",
  "3": "When Cursor ignores the spec and writes a naive `POST /refunds` handler, our `ts-morph` AST and PII taint engine blocks it deterministically: missing idempotency (`S2`), float fee math (`S1`), direct `db.update(ledgerEntries)` (`S3`), and raw merchant PII in `c.json` (`S4`). Crucially, Standards Guard quarantines these findings in Cursor's private Meko memory (`memory_add`) so an unreviewed agent cannot poison team context. Cursor inspects the pending items via `guard_queue_list` over MCP—confirming agents cannot self-promote under `ADR-008`—before a human maintainer runs `approve`, calling `memory_promote` and logging an audit message to Meko Conversations.",
  "4": "Now a fresh OpenCode session starts with zero chat history. Running `opencode run` calls `guard_preflight` over MCP and immediately receives the exact ADR chunk plus the newly promoted lesson. OpenCode implements `POST /refunds` using `requireIdempotency`, `multiplyBpsBankers`, `reverseLedgerGroup`, and `toPublicMerchantDto`—passing `guard check` on its very first try. Running `standards-guard release-gate` verifies all AST and SQLite ledger invariants and emits a SHA-256 compliance receipt artifact directly into Meko.",
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

  REPORT_WRITTEN=1
  FINAL_TOTAL_MMSS="$total_mmss"
  if [[ "$quiet" -eq 0 ]]; then
    echo "[demo-runner] Saved timestamp & VO cue sheet: ${LOG_PATH} (total ${total_mmss})"
  fi
}

cleanup() {
  local exit_code=$?
  if [[ "$REPORT_WRITTEN" -eq 1 && "$NO_LOG" -eq 0 ]]; then
    echo "[demo-runner] Saved timestamp & VO cue sheet: ${LOG_PATH} (total ${FINAL_TOTAL_MMSS})"
  else
    write_timestamp_report 0 || true
  fi
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

load_dotenv_exports() {
  local env_file="${REPO_ROOT}/.env"
  [[ -f "$env_file" ]] || return 0
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[2]}"
    case "$key" in
      MEKO_API_TOKEN|MEKO_MCP_URL|MEKO_DATAPACK) ;;
      *) continue ;;
    esac
    if [[ -n "${!key:-}" ]]; then
      continue
    fi
    val="${BASH_REMATCH[3]}"
    if [[ "$val" =~ ^\"([^\"]*)\"[[:space:]]*(#.*)?$ ]]; then
      val="${BASH_REMATCH[1]}"
    elif [[ "$val" =~ ^\'([^\']*)\'[[:space:]]*(#.*)?$ ]]; then
      val="${BASH_REMATCH[1]}"
    else
      val="${val%%#*}"
      val="$(printf '%s' "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    fi
    if [[ -n "$val" ]]; then
      export "$key=$val"
    fi
  done < "$env_file"
}

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

load_dotenv_exports

if [[ "$SKIP_AGENT_MCP" -eq 0 ]]; then
  CURSOR_AGENT_BIN="$(command -v cursor-agent 2>/dev/null || true)"
  OPENCODE_BIN="$(command -v opencode 2>/dev/null || true)"
  if [[ -n "$CURSOR_AGENT_BIN" && "$SKIP_AGENT_PROMPTS" -eq 0 ]]; then
    if command -v timeout >/dev/null 2>&1; then
      cursor_status_out="$(timeout 5s "$CURSOR_AGENT_BIN" status 2>&1 || true)"
    else
      cursor_status_out="$("$CURSOR_AGENT_BIN" status 2>&1 || true)"
    fi
    if [[ -n "$cursor_status_out" ]] && ! printf '%s\n' "$cursor_status_out" | grep -iq "not logged in"; then
      CURSOR_LOGGED_IN=1
    fi
  fi
  if [[ -n "$OPENCODE_BIN" ]] && has_live_token; then
    opencode_mcp_status="$("$OPENCODE_BIN" mcp list 2>/dev/null || true)"
    if ! printf '%s\n' "$opencode_mcp_status" | grep -Eq 'meko[[:space:]]+connected' || \
       ! printf '%s\n' "$opencode_mcp_status" | grep -Eq 'standards-guard[[:space:]]+connected'; then
      "$OPENCODE_BIN" service restart >/dev/null 2>&1 || true
      sleep 2
    fi
  fi
fi

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

  let cursorMoves = 0;
  let cursorClicks = 0;

  function ensureCursor() {
    let el = document.getElementById("meko-demo-cursor");
    if (!el) {
      el = document.createElement("div");
      el.id = "meko-demo-cursor";
      el.style.position = "fixed";
      el.style.left = "0";
      el.style.top = "0";
      el.style.width = "24px";
      el.style.height = "24px";
      el.style.pointerEvents = "none";
      el.style.zIndex = "2147483647";
      el.style.transformOrigin = "top left";
      el.style.transition = "opacity 180ms ease";
      el.innerHTML =
        '<svg viewBox="0 0 24 24" width="24" height="24" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45));">' +
        '<path d="M4 3 L4 19 L9.2 14.2 L12.4 20.5 L15.1 19.2 L11.9 12.9 L18.5 12.9 Z" fill="#0f172a" stroke="#f8fafc" stroke-width="1.8" stroke-linejoin="round"/>' +
        "</svg>";
      (document.body || document.documentElement).appendChild(el);
    }
    if (!window.__mekoCursorPos) {
      window.__mekoCursorPos = {
        x: Math.round(window.innerWidth * 0.68),
        y: Math.round(window.innerHeight * 0.32)
      };
    }
    el.style.transform =
      "translate3d(" +
      Math.round(window.__mekoCursorPos.x) +
      "px," +
      Math.round(window.__mekoCursorPos.y) +
      "px,0)";
    return el;
  }

  function clickRipple(x, y) {
    if (fast) return;
    const ring = document.createElement("div");
    ring.style.position = "fixed";
    ring.style.left = Math.round(x - 13) + "px";
    ring.style.top = Math.round(y - 13) + "px";
    ring.style.width = "26px";
    ring.style.height = "26px";
    ring.style.borderRadius = "9999px";
    ring.style.border = "2px solid rgba(56, 189, 248, 0.75)";
    ring.style.pointerEvents = "none";
    ring.style.zIndex = "2147483646";
    ring.style.transform = "scale(0.35)";
    ring.style.opacity = "0.9";
    ring.style.transition = "transform 360ms cubic-bezier(0.22, 1, 0.36, 1), opacity 360ms ease-out";
    (document.body || document.documentElement).appendChild(ring);
    requestAnimationFrame(() => {
      ring.style.transform = "scale(1.85)";
      ring.style.opacity = "0";
    });
    setTimeout(() => {
      ring.remove();
    }, 390);
  }

  async function moveCursorTo(targetX, targetY) {
    const cursorEl = ensureCursor();
    const tx = Math.max(8, Math.min(window.innerWidth - 12, targetX));
    const ty = Math.max(8, Math.min(window.innerHeight - 12, targetY));
    const start = window.__mekoCursorPos || { x: tx, y: ty };
    const sx = start.x;
    const sy = start.y;
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);

    if (fast || dist < 4) {
      window.__mekoCursorPos = { x: tx, y: ty };
      cursorEl.style.transform = "translate3d(" + Math.round(tx) + "px," + Math.round(ty) + "px,0)";
      cursorMoves += 1;
      await sleep(15);
      return;
    }

    const dur = Math.round(Math.min(720, Math.max(240, 175 + Math.sqrt(dist) * 19)));
    const nx = -dy / (dist || 1);
    const ny = dx / (dist || 1);
    const sign = Math.random() < 0.5 ? 1 : -1;
    const arc = Math.min(42, Math.max(12, dist * 0.14)) * sign;
    const c1x = sx + dx * 0.3 + nx * arc;
    const c1y = sy + dy * 0.3 + ny * arc;
    const c2x = sx + dx * 0.72 + nx * (arc * 0.55);
    const c2y = sy + dy * 0.72 + ny * (arc * 0.55);
    const useOvershoot = dist > 300;
    const overshootDist = useOvershoot ? 4 + Math.random() * 4 : 0;
    const ux = dx / (dist || 1);
    const uy = dy / (dist || 1);

    await new Promise((resolve) => {
      const t0 = performance.now();
      let settled = false;
      const safetyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          window.__mekoCursorPos = { x: tx, y: ty };
          cursorEl.style.transform = "translate3d(" + Math.round(tx) + "px," + Math.round(ty) + "px,0)";
          resolve();
        }
      }, dur + 250);

      function frame(now) {
        if (settled) return;
        const rawT = Math.min(1, (now - t0) / dur);
        const u = rawT * rawT * (3 - 2 * rawT);
        const inv = 1 - u;
        let x =
          inv * inv * inv * sx +
          3 * inv * inv * u * c1x +
          3 * inv * u * u * c2x +
          u * u * u * tx;
        let y =
          inv * inv * inv * sy +
          3 * inv * inv * u * c1y +
          3 * inv * u * u * c2y +
          u * u * u * ty;

        if (useOvershoot && rawT > 0.72) {
          const bump = Math.sin(((rawT - 0.72) / 0.28) * Math.PI);
          x += ux * overshootDist * bump;
          y += uy * overshootDist * bump;
        }

        cursorEl.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";
        if (rawT < 1) {
          requestAnimationFrame(frame);
        } else {
          settled = true;
          clearTimeout(safetyTimer);
          window.__mekoCursorPos = { x: tx, y: ty };
          cursorEl.style.transform = "translate3d(" + Math.round(tx) + "px," + Math.round(ty) + "px,0)";
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
    cursorMoves += 1;
  }

  async function moveCursorToElement(el, offsetFracX = 0.5, offsetFracY = 0.5) {
    if (!el) return false;
    let rect = el.getBoundingClientRect();
    if (rect.top < 20 || rect.bottom > window.innerHeight - 20) {
      el.scrollIntoView({ behavior: fast ? "auto" : "smooth", block: "center" });
      await sleep(fast ? 40 : 380);
      rect = el.getBoundingClientRect();
    }
    const padX = Math.min(10, rect.width * 0.2);
    const padY = Math.min(8, rect.height * 0.2);
    const jx = (Math.random() - 0.5) * Math.min(14, rect.width * 0.14);
    const jy = (Math.random() - 0.5) * Math.min(8, rect.height * 0.14);
    const rawX = rect.left + rect.width * offsetFracX + jx;
    const rawY = rect.top + rect.height * offsetFracY + jy;
    const tx = Math.max(rect.left + padX, Math.min(rect.right - padX, rawX));
    const ty = Math.max(rect.top + padY, Math.min(rect.bottom - padY, rawY));
    await moveCursorTo(tx, ty);
    el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: tx, clientY: ty }));
    return true;
  }

  async function humanClick(el, prePauseMs = 95, postPauseMs = 180) {
    if (!el) return false;
    await moveCursorToElement(el);
    await sleep(prePauseMs);
    const cursorEl = ensureCursor();
    const pos = window.__mekoCursorPos || { x: 0, y: 0 };
    const baseTx = "translate3d(" + Math.round(pos.x) + "px," + Math.round(pos.y) + "px,0)";
    cursorEl.style.transform = baseTx + " scale(0.86)";
    clickRipple(pos.x, pos.y);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: pos.x, clientY: pos.y }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: pos.x, clientY: pos.y }));
    el.click();
    setTimeout(() => {
      cursorEl.style.transform = baseTx;
    }, 75);
    cursorClicks += 1;
    await sleep(postPauseMs);
    return true;
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
    await sleep(fast ? 50 : 280);
    await moveCursorToElement(el, 0.42, 0.35);
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
    await humanClick(btn, 100, 200);
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
          await humanClick(toggle, 80, 320);
        }
        const mobileNav = Array.from(document.querySelectorAll("header + div nav")).find(isVisible) || document;
        btn = findButton(label, mobileNav);
      }
    }

    if (!btn) {
      btn = findButton(label);
    }

    if (btn) {
      await humanClick(btn, 110, 360);
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

  ensureCursor();
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
      await humanClick(s2Btn, 95, 500);
    }
    const s3Btn = findButton("S3 · ADR-003");
    if (s3Btn) {
      await humanClick(s3Btn, 95, 420);
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
      await humanClick(sharedBtn, 95, 720);
      const sharedCard =
        (arg1 && findCardContaining(arg1, ".divide-y > div, .p-4")) ||
        document.querySelector("main .divide-y > div");
      detail.sharedHighlighted = await spotlight(sharedCard, 500);
    }
    const convBtn = findButton("Conversations");
    if (convBtn) {
      await humanClick(convBtn, 95, 720);
      const convCard = document.querySelector("main .divide-y > div");
      detail.convHighlighted = await spotlight(convCard, 500);
    }
    const allBtn = findButton("All Primitives");
    if (allBtn) {
      await humanClick(allBtn, 95, 320);
    }
    await scrollToTop();
  } else if (action === "beat4a_opencode") {
    detail.refreshed = await clickRefresh();
    if ((new URLSearchParams(window.location.search).get("view") || "queue") !== "timeline") {
      detail.nav = await clickNav("Cross-Agent Timeline", "timeline");
    }
    const slBtn = findButton("Self-Learning");
    if (slBtn) {
      await humanClick(slBtn, 95, 420);
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
      await humanClick(artBtn, 95, 420);
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
    await sleep(400);
    const summaryGrid = findCardContaining("Total Rule Violations", ".grid");
    if (summaryGrid) {
      const kpiCards = Array.from(summaryGrid.children).filter(isVisible);
      for (const kc of kpiCards.slice(0, 3)) {
        await moveCursorToElement(kc, 0.5, 0.5);
        await sleep(220);
      }
    }
    detail.summaryHighlighted = await spotlight(summaryGrid, 850);
    const tableEl = document.querySelector("table");
    detail.tableHighlighted = await spotlight(tableEl, 850);
  } else {
    return { ok: false, action, error: "unknown_action" };
  }

  detail.cursor = { ready: true, moves: cursorMoves, clicks: cursorClicks };
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
    }, 30000);

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

mark_step_start() {
  STEP_START_MS="$(elapsed_ms)"
}

dwell_sleep() {
  local base_sec="$1"
  local scale="${DEMO_DWELL_SCALE:-1}"
  local dur
  dur="$(awk -v b="$base_sec" -v s="$scale" 'BEGIN { v = b * s; if (v < 0) v = 0; printf "%.2f", v }')"
  if [[ "$dur" != "0.00" ]]; then
    sleep "$dur"
  fi
}

wait_next() {
  local label="$1"
  local target_cum="${2:-}"
  local target_step_sec="${3:-0}"
  local min_hold_sec="${4:-0}"
  if [[ "$AUTO" -eq 1 ]]; then
    return 0
  fi
  if [[ "$HANDSFREE" -eq 1 && "$RUN_START_MS" -gt 0 ]]; then
    local now_el
    now_el="$(elapsed_ms)"
    local spent_ms=$(( now_el - STEP_START_MS ))
    if (( spent_ms < 0 )); then
      spent_ms=0
    fi
    local rem_sec
    rem_sec="$(awk -v tgt="$target_step_sec" -v spent="$spent_ms" -v min="$min_hold_sec" 'BEGIN { rem = tgt - (spent / 1000.0); if (rem < min) rem = min; if (rem < 0) rem = 0; printf "%.2f", rem }')"
    dwell_sleep "$rem_sec"
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

  if [[ "$FAST" -eq 1 || ( ! -t 1 && "${DEMO_TYPING_FORCE:-0}" != "1" ) ]]; then
    printf '%s\n' "$cmd_text"
    return 0
  fi

  node - "$cmd_text" "$TYPING_WPM" "$TYPING_ACCURACY" <<'NODE'
const [cmdText, wpmStr, accStr] = process.argv.slice(2);
const wpm = Math.max(15, Math.min(200, Number(wpmStr) || 51));
const acc = Math.max(50, Math.min(100, Number(accStr) || 86));
const rawScale = Number(process.env.DEMO_TYPING_SCALE ?? "1");
const scale = Number.isFinite(rawScale) && rawScale > 0 ? Math.max(0.005, rawScale) : 1;

let seed = process.env.DEMO_TYPING_SEED
  ? (Number(process.env.DEMO_TYPING_SEED) >>> 0)
  : ((Date.now() ^ (process.pid << 8)) >>> 0);
if (seed === 0) seed = 0x9e3779b9;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randRange(min, max) {
  return min + (max - min) * rand();
}
function bellJitter(min, max) {
  return min + (max - min) * ((rand() + rand()) / 2);
}

const ADJACENT = {
  a: "qwsz", b: "vghn", c: "xdfv", d: "erfcxs", e: "wsdr",
  f: "rtgvcd", g: "tyhbvf", h: "yujnbg", i: "ujko", j: "uikmnh",
  k: "iolmj", l: "opk", m: "njk", n: "bhjm", o: "iklp",
  p: "ol", q: "wa", r: "edft", s: "wedxza", t: "rfgy",
  u: "yhji", v: "cfgb", w: "qase", x: "zsdc", y: "tghu", z: "asx",
  "0": "9op-", "1": "2q", "2": "13qw", "3": "24we", "4": "35er",
  "5": "46rt", "6": "57ty", "7": "68yu", "8": "79ui", "9": "80io",
  "-": "0p_", ".": ",/", "/": ".", "_": "-="
};

const targetNetMsPerChar = 60000 / (wpm * 5);
const errorRate = Math.max(0, Math.min(0.45, (100 - acc) / 100));
const baseCharMs = Math.max(45, targetNetMsPerChar - errorRate * 500);

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.round(ms * scale))));
}

function writeOut(str) {
  process.stdout.write(str);
}

async function run() {
  const chars = Array.from(cmdText);
  let lastWasSpace = false;

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const lower = ch.toLowerCase();
    const nextCh = i + 1 < chars.length ? chars[i + 1] : "";
    const isUpper = ch !== lower;
    const isLowerAlpha = /^[a-z]$/.test(ch);
    const eligible = i > 0 && /^[a-z0-9\-./_]$/.test(ch) && Boolean(ADJACENT[ch]);

    if (eligible && rand() < errorRate) {
      const modeRoll = rand();
      if (modeRoll < 0.2 && nextCh && /^[a-z]$/.test(nextCh) && nextCh !== ch) {
        // Transposition slip: type nextCh then ch, pause to notice, backspace twice, then type ch
        writeOut(nextCh);
        await waitMs(randRange(75, 130));
        writeOut(ch);
        await waitMs(randRange(180, 310));
        writeOut("\b \b");
        await waitMs(randRange(85, 135));
        writeOut("\b \b");
        await waitMs(randRange(70, 120));
      } else if (modeRoll < 0.35 && isLowerAlpha) {
        // Double-tap slip: type ch twice, pause to notice, backspace once, continue
        writeOut(ch);
        await waitMs(randRange(55, 95));
        writeOut(ch);
        await waitMs(randRange(160, 260));
        writeOut("\b \b");
        await waitMs(randRange(65, 115));
        lastWasSpace = false;
        continue;
      } else {
        // Adjacent QWERTY key slip (+ occasional 1-char overshoot)
        const neighbors = ADJACENT[ch];
        const wrong = neighbors[Math.floor(rand() * neighbors.length)] || ch;
        writeOut(wrong);
        let overshoot = false;
        if (nextCh && !/\s/.test(nextCh) && rand() < 0.3) {
          overshoot = true;
          await waitMs(randRange(65, 125));
          writeOut(nextCh);
        }
        await waitMs(randRange(180, 320));
        if (overshoot) {
          writeOut("\b \b");
          await waitMs(randRange(85, 135));
        }
        writeOut("\b \b");
        await waitMs(randRange(65, 120));
      }
    }

    writeOut(ch);

    let delay = baseCharMs * bellJitter(0.62, 1.42);
    if (isUpper || /[-/.0-9_]/.test(ch)) {
      delay += randRange(50, 130);
    }
    if (ch === " " && !lastWasSpace && rand() < 0.08) {
      delay += randRange(140, 280);
    }
    lastWasSpace = ch === " ";
    await waitMs(delay);
  }

  await waitMs(randRange(180, 340));
  writeOut("\n");
}

run().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
NODE
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

run_cmd_timeout() {
  local allow_fail="$1"
  local timeout_sec="$2"
  shift 2
  local display
  display="$(format_cmd_display "$@")"
  print_cmd "$display"
  local cmd_start_ms
  cmd_start_ms="$(elapsed_ms)"
  local rc=0
  if command -v timeout >/dev/null 2>&1; then
    if timeout "${timeout_sec}s" "$@"; then
      rc=0
    else
      rc=$?
    fi
  else
    if "$@"; then
      rc=0
    else
      rc=$?
    fi
  fi
  record_cmd_event "$cmd_start_ms" "$(elapsed_ms)" "$display"
  if [[ "$rc" -eq 0 ]]; then
    return 0
  fi
  if [[ "$rc" -eq 124 ]]; then
    if [[ -t 1 ]]; then
      printf '\033[2m[demo-runner] agent prompt timed out after %ss — continuing\033[0m\n' "$timeout_sec"
    else
      echo "[demo-runner] agent prompt timed out after ${timeout_sec}s — continuing"
    fi
  fi
  if [[ "$allow_fail" -eq 1 ]]; then
    return 0
  fi
  return "$rc"
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
if [[ "$SKIP_AGENT_MCP" -eq 1 ]]; then
  echo "Agent MCP: skipped (--no-agent-mcp)"
else
  AGENT_MCP_PARTS=()
  if [[ -n "$CURSOR_AGENT_BIN" ]] && has_live_token; then
    AGENT_MCP_PARTS+=("cursor-agent")
  fi
  if [[ -n "$OPENCODE_BIN" ]]; then
    AGENT_MCP_PARTS+=("opencode")
  fi
  if [[ "${#AGENT_MCP_PARTS[@]}" -gt 0 ]]; then
    AGENT_MCP_JOINED="${AGENT_MCP_PARTS[0]}"
    for ((i = 1; i < ${#AGENT_MCP_PARTS[@]}; i++)); do
      AGENT_MCP_JOINED+=" + ${AGENT_MCP_PARTS[$i]}"
    done
    echo "Agent MCP: ${AGENT_MCP_JOINED} (zero-quota MCP handshake in Beat 1)"
  else
    echo "Agent MCP: none detected (or missing MEKO_API_TOKEN for cursor-agent)"
  fi
fi
if [[ "$SKIP_AGENT_MCP" -eq 1 || "$SKIP_AGENT_PROMPTS" -eq 1 ]]; then
  echo "Agent Run: skipped"
else
  if [[ "$MODE" == "mock" ]]; then
    if [[ "$CURSOR_LOGGED_IN" -eq 1 ]]; then
      CURSOR_LOGIN_LABEL="logged in"
    else
      CURSOR_LOGIN_LABEL="NOT logged in — run 'cursor-agent login'"
    fi
    echo "Agent Run: mock-skipped (0 quota; in --live: cursor-agent [${CURSOR_LOGIN_LABEL}] + opencode -m ${OPENCODE_MODEL}, timeout ${AGENT_TIMEOUT}s)"
  else
    if [[ "$CURSOR_LOGGED_IN" -eq 1 ]]; then
      CURSOR_LOGIN_LABEL="logged in"
    else
      CURSOR_LOGIN_LABEL="NOT logged in — Beat 3 prompt will be skipped"
    fi
    echo "Agent Run: cursor-agent [${CURSOR_LOGIN_LABEL}] + opencode -m ${OPENCODE_MODEL} (timeout ${AGENT_TIMEOUT}s)"
  fi
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
if [[ "$FAST" -eq 1 ]]; then
  echo "Typing   : fast (instant)"
else
  echo "Typing   : human (~${TYPING_WPM} WPM, ${TYPING_ACCURACY}% accuracy with realistic typos & backspace)"
fi
if [[ "$HANDSFREE" -eq 1 ]]; then
  echo "Pacing   : handsfree (press Enter ONCE -> auto-runs all 5 beats, target ~03:55-04:10 live)"
fi
echo ""
if [[ "$HANDSFREE" -eq 1 ]]; then
  if [[ "$OPEN_BROWSER" -eq 1 ]]; then
    echo "Snap Terminal left (Super+Left) and Browser right (Super+Right), start OBS recording, then press Enter ONCE."
  else
    echo "Start OBS recording, then press Enter ONCE to run Beats ${START_STEP}-5 automatically."
  fi
  wait_next "Start FULL AUTO Demo (Beat ${START_STEP}/5)"
else
  if [[ "$OPEN_BROWSER" -eq 1 ]]; then
    echo "Snap Terminal left (Super+Left) and Browser right (Super+Right), start OBS recording, then just press Enter at each step."
  else
    echo "Start OBS recording, then press Enter to clear screen and start Beat ${START_STEP}/5."
  fi
  wait_next "Start Beat ${START_STEP}/5"
fi

RUN_START_MS="$(now_ms)"

# Beat 1 — Problem & 5-Primitive Meko Architecture
if (( START_STEP <= 1 )); then
  begin_beat 1 "Problem & 5-Primitive Meko Architecture" "00:40"
  mark_step_start
  clear_screen
  run_cmd 0 npm run guard:status -- "${MODE_ARGS[@]}"
  browser_action beat1_overview
  if [[ "$SKIP_AGENT_MCP" -eq 0 ]]; then
    if [[ -n "$CURSOR_AGENT_BIN" ]] && has_live_token; then
      run_cmd 1 cursor-agent mcp list
      run_cmd 1 cursor-agent mcp list-tools standards-guard
    fi
    if [[ -n "$OPENCODE_BIN" ]]; then
      run_cmd 1 opencode mcp list
    fi
  fi
  wait_next "Beat 2/5: Pre-Implementation Spec Gate & Blast Radius" "00:40" 36 4
  end_active_beat
fi

# Beat 2 — Pre-Implementation Spec Gate & ADR-003 Blast Radius
if (( START_STEP <= 2 )); then
  begin_beat 2 "Pre-Implementation Spec Gate & ADR-003 Blast Radius" "00:45"
  mark_step_start
  clear_screen
  run_cmd 1 npm run guard:spec-check -- specs/001-refunds-rfc.md "${MODE_ARGS[@]}"
  browser_action beat2a_spec
  wait_next "Beat 2b: ADR-003 Blast Radius" "01:00" 18 4
  mark_step_start
  run_cmd 0 npm run guard:impact -- ADR-003
  browser_action beat2b_blast
  wait_next "Blast Radius ?view=blast -> Enter for Beat 3/5" "01:15" 15 4
  end_active_beat
fi

# Beat 3 — Agent A (Cursor) Blocked -> Queue -> Human Gate (memory_promote)
if (( START_STEP <= 3 )); then
  begin_beat 3 "Agent A (Cursor) Blocked -> Human Gate (memory_promote)" "01:10"
  mark_step_start
  clear_screen
  run_cmd_tee 1 "${CHECK_OUT}" npm run guard:check -- --agent cursor --files fixtures/benchmark/runs/t1-baseline-cursor.ts "${MODE_ARGS[@]}"
  MEM_ID="$(extract_mem_id_from_check "${CHECK_OUT}")"
  wait_next "Beat 3b: Inspect Private Approval Queue" "01:40" 22 4
  mark_step_start
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
  if [[ "$SKIP_AGENT_MCP" -eq 0 && "$SKIP_AGENT_PROMPTS" -eq 0 ]]; then
    if [[ "$MODE" == "live" ]]; then
      if [[ -n "$CURSOR_AGENT_BIN" && "$CURSOR_LOGGED_IN" -eq 1 ]] && has_live_token; then
        run_cmd_timeout 1 "$AGENT_TIMEOUT" cursor-agent -p --mode ask --approve-mcps --trust "Use standards-guard guard_queue_list and summarize the pending private memories in 2 concise bullets (confirm agents cannot self-promote)."
      elif [[ -n "$CURSOR_AGENT_BIN" ]]; then
        if [[ -t 1 ]]; then
          printf '\033[2m[demo-runner] Skipping live cursor-agent prompt (not logged in; run '\''cursor-agent login'\'').\033[0m\n'
        else
          echo "[demo-runner] Skipping live cursor-agent prompt (not logged in; run 'cursor-agent login')."
        fi
      fi
    else
      if [[ -t 1 ]]; then
        printf '\033[2m[mock mode] Skipping live cursor-agent MCP prompt (0 quota; runs automatically in --live).\033[0m\n'
      else
        echo "[mock mode] Skipping live cursor-agent MCP prompt (0 quota; runs automatically in --live)."
      fi
    fi
  fi
  wait_next "Beat 3c: Approve ${MEM_ID} (memory_promote -> shared)" "02:10" 26 4
  mark_step_start
  run_cmd 0 npm run guard:approve -- "${MEM_ID}" --reason "Verified ADR-002/003/004 refund safeguards" --by rizal "${MODE_ARGS[@]}"
  browser_action beat3c_timeline "${MEM_ID}"
  wait_next "Timeline ?view=timeline (ID ${MEM_ID} synced) -> Beat 4/5" "02:35" 24 4
  end_active_beat
fi

# Beat 4 — Agent B (OpenCode) Vaccinated First-Try Pass & Release Gate
if (( START_STEP <= 4 )); then
  begin_beat 4 "Agent B (OpenCode) Vaccinated First-Try Pass & Release Gate" "01:00"
  mark_step_start
  clear_screen
  if [[ "$SKIP_AGENT_MCP" -eq 0 && "$SKIP_AGENT_PROMPTS" -eq 0 ]]; then
    if [[ "$MODE" == "live" ]]; then
      if [[ -n "$OPENCODE_BIN" ]] && has_live_token; then
        run_cmd_timeout 1 "$AGENT_TIMEOUT" opencode run --auto -m "$OPENCODE_MODEL" "Use standards-guard guard_preflight for POST /refunds and list the top ADR and promoted shared-memory rules in 3 concise bullets."
      fi
    else
      if [[ -t 1 ]]; then
        printf '\033[2m[mock mode] Skipping live opencode run MCP prompt (0 quota; runs automatically in --live).\033[0m\n'
      else
        echo "[mock mode] Skipping live opencode run MCP prompt (0 quota; runs automatically in --live)."
      fi
    fi
  fi
  run_cmd 0 npm run guard:check -- --agent opencode --files fixtures/benchmark/runs/t1-guarded-opencode.ts --record-fix "${MODE_ARGS[@]}"
  browser_action beat4a_opencode
  wait_next "Beat 4b: Run Release Gate & Emit SHA-256 Receipt" "03:15" 36 4
  mark_step_start
  run_cmd_tee 0 "${RELEASE_OUT}" npm run guard:release-gate -- "${MODE_ARGS[@]}"
  RECEIPT_SHA="$(extract_receipt_sha "${RELEASE_OUT}")"
  browser_action beat4b_receipt "${RECEIPT_SHA}"
  wait_next "Beat 5/5: Show A/B Benchmark & Closing" "03:35" 18 4
  end_active_beat
fi

# Beat 5 — A/B Benchmark Results & Offline Quickstart CTA (zero extra Meko calls)
if (( START_STEP <= 5 )); then
  begin_beat 5 "A/B Benchmark Results & Offline Quickstart CTA" "00:45"
  mark_step_start
  browser_action beat5_benchmark
  if [[ "$START_STEP" -eq 5 ]]; then
    clear_screen
    if [[ "$NO_UI" -eq 0 ]]; then
      echo "Benchmark UI: http://127.0.0.1:${PORT}/?view=benchmark"
    fi
    echo "Show Benchmark UI & README.md Quickstart."
  fi
  if [[ "$HANDSFREE" -eq 1 ]]; then
    BEAT5_SPENT_MS=$(( $(elapsed_ms) - STEP_START_MS ))
    if (( BEAT5_SPENT_MS < 0 )); then
      BEAT5_SPENT_MS=0
    fi
    BEAT5_DWELL="$(awk -v tgt="20" -v spent="$BEAT5_SPENT_MS" -v min="14" 'BEGIN { rem = tgt - (spent / 1000.0); if (rem < min) rem = min; if (rem < 0) rem = 0; printf "%.2f", rem }')"
    dwell_sleep "$BEAT5_DWELL"
    end_active_beat
    write_timestamp_report 1
    DONE_TS="${FINAL_TOTAL_MMSS:-$(fmt_mmss "$(elapsed_ms)")}"
    if [[ -t 1 ]]; then
      printf '\033[2m[%s | Demo complete. Stop OBS recording, then press Enter to close Chrome & guard:ui] \033[0m' "$DONE_TS"
    else
      printf '[%s | Demo complete. Stop OBS recording, then press Enter to close Chrome & guard:ui] ' "$DONE_TS"
    fi
    read -r _ || true
  else
    wait_next "Stop guard:ui and finish demo" "04:15"
    end_active_beat
  fi
fi
