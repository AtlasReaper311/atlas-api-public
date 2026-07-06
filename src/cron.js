/**
 * The scheduled pass, every ten minutes, two jobs in strict order:
 *
 *   1. Dead-man's switch: if the sentinel has been silent past the
 *      threshold, mark the infra state stale-down and alert once. The
 *      sentinel cannot report its own death; this is the half of the
 *      reachability model only the edge can do.
 *   2. Estate probes and uptime accumulation, which read the infra
 *      state for the machine component; running second means they see
 *      the corrected verdict, not a stale ok.
 *
 * Alert discipline: the estate probes never alert. Corpus and machine
 * failures already alert through the infra pipeline; a second source
 * for the same failure would just be double noise. Probes feed uptime
 * and the badge, nothing else.
 */

import { nowIso } from "./lib/http.js";
import { notify } from "./lib/notify.js";
import { readState, staleAfterMs, STATE_KEY } from "./routes/infra.js";
import { runEstatePass } from "./lib/status.js";

async function checkSentinelSilence(env) {
  const state = await readState(env);
  if (!state || state.stale) return;

  const age = Date.now() - Date.parse(state.last_report_at);
  if (!Number.isFinite(age) || age < staleAfterMs(env)) return;

  const marked = {
    ...state,
    stale: true,
    overall: "down",
    since: nowIso(),
    updated_at: nowIso(),
  };
  await env.ATLAS_PUBLIC_KV.put(STATE_KEY, JSON.stringify(marked));

  await notify(
    env,
    {
      level: "failure",
      title: "Infra health: sentinel silent",
      message:
        `no report from ${state.machine} for ${Math.round(age / 60000)} minutes; ` +
        "machine asleep, tunnel down, or the sentinel itself died",
      fields: {
        last_report_at: state.last_report_at,
        threshold_minutes: String(Math.round(staleAfterMs(env) / 60000)),
      },
    },
    "infra_health",
  );
}

export async function runCron(env) {
  await checkSentinelSilence(env);
  await runEstatePass(env);
}
