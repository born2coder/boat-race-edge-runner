const ROOT = 'https://api.github.com/repos/born2coder/boat-race-edge-runner';
const WORKFLOW = 'research-forward.yml';
const LIMIT = 512000;

async function readJson(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMIT) { await reader.cancel(); throw new Error('response_limit'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function check(env, now = Date.now(), request = fetch) {
  if (env.WATCHDOG_ENABLED !== '1') return { status: 'disabled' };
  if (!env.GITHUB_ACTIONS_TOKEN) return { status: 'missing_secret' };
  const jst = new Date(now + 9 * 3600000);
  const minute = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  if (minute < 450 || minute >= 1290) return { status: 'outside_hours' }; // 07:30–21:29 JST
  const dayStart = Date.parse(jst.toISOString().slice(0, 10) + 'T00:00:00+09:00');
  const headers = {
    Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'boat-edge-startup-watchdog',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  async function api(path, options = {}) {
    const response = await request(ROOT + path, {
      ...options, headers: { ...headers, ...options.headers },
      redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`github_http_${response.status}`);
    return response.status === 204 ? null : readJson(response);
  }
  // A successful directory listing distinguishes an absent stop file from
  // authorization/network errors. Never delete or modify the stop record.
  const files = await api('/contents/state/edge_v2?ref=edge-data');
  if (!Array.isArray(files) || !files.some(f => f.name === 'days' && f.type === 'dir'))
    return { status: 'invalid_state_directory' };
  if (files.some(f => f.name === 'forward-paused.json')) return { status: 'persistent_stop' };
  const workflow = await api(`/actions/workflows/${WORKFLOW}`);
  if (workflow.state !== 'active') return { status: 'workflow_disabled' };
  const data = await api(`/actions/workflows/${WORKFLOW}/runs?per_page=20&branch=main`);
  const runs = data.workflow_runs;
  if (!Array.isArray(runs) || !runs.length) return { status: 'missing_history' };
  if (runs.some(r => r.status !== 'completed')) return { status: 'already_running' };
  const latest = runs[0];
  if (latest.conclusion !== 'success') return { status: 'previous_run_stopped', runId: latest.id };
  // Do not turn a skipped job / failed initialization into a retry loop.
  const jobs = await api(`/actions/runs/${latest.id}/jobs?per_page=10`);
  if (!Array.isArray(jobs.jobs) || jobs.total_count !== jobs.jobs.length || !jobs.jobs.length ||
      jobs.jobs.some(j => j.conclusion !== 'success') ||
      !jobs.jobs.some(j => j.steps?.some(s => s.name === 'Observe and record new research only' && s.conclusion === 'success')))
    return { status: 'previous_job_not_successful' };
  const updated = Date.parse(latest.updated_at);
  if (!Number.isFinite(updated) || now - updated < 15 * 60000) return { status: 'cooldown' };
  const dates = runs.map(r => Date.parse(r.created_at));
  if (dates.some(d => !Number.isFinite(d))) return { status: 'invalid_history' };
  if (runs.length >= 20 && dates.at(-1) >= dayStart) return { status: 'history_limit' };
  // Manual starts count too. Bound fallback starts independently of the
  // existing runner's request/CPU caps, which remain authoritative.
  if (runs.filter((r, i) => dates[i] >= dayStart && r.event === 'workflow_dispatch').length >= 4)
    return { status: 'daily_dispatch_limit' };
  // Recheck immediately before the only mutation (no retry on errors).
  const finalFiles = await api('/contents/state/edge_v2?ref=edge-data');
  if (!Array.isArray(finalFiles) || !finalFiles.some(f => f.name === 'days' && f.type === 'dir'))
    return { status: 'invalid_state_directory' };
  if (finalFiles.some(f => f.name === 'forward-paused.json')) return { status: 'persistent_stop' };
  await api(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { once: false } }),
  });
  return { status: 'dispatched' };
}

export default {
  fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(controller, env) {
    try { console.log(JSON.stringify(await check(env))); }
    catch (error) {
      // Never log response bodies, headers, credentials or arbitrary errors.
      const code = /^github_http_\d{3}$|^response_limit$/.test(error.message) ? error.message : 'check_failed';
      console.log(JSON.stringify({ status: 'blocked', code }));
      throw new Error(code);
    }
  },
};
