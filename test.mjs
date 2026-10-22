// Run: node test.mjs. Feeds pennies.mjs made-up transcripts and checks the messages.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pennies-'));
const script = fileURLToPath(new URL('pennies.mjs', import.meta.url));
const run = (hook) => new Promise((resolve, reject) => {
  const child = execFile(process.execPath, [script], (err, out) => (err ? reject(err) : resolve(JSON.parse(out).systemMessage)));
  child.stdin.end(JSON.stringify({ session_id: 's1', cwd: dir, hook_event_name: 'Stop', ...hook }));
});

// Codex
const usage = (input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens) => ({
  input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens,
  reasoning_output_tokens: 0, total_tokens: input_tokens + output_tokens,
});
const line = (type, payload) => JSON.stringify({ timestamp: '2026-10-22T10:00:00.000Z', type, payload });
const record = (turn_id, u) => line('token_usage_record', { turn_id, root_turn_id: turn_id, response_id: 'r', usage: u });

const codex = join(dir, 'rollout.jsonl');
writeFileSync(codex, [
  line('session_meta', { id: 's1' }),
  line('turn_context', { turn_id: 't1', model: 'gpt-5.5' }),
  record('t1', usage(10_000, 0, 0, 1_100)),            // $0.083
  record('t1', usage(20_000, 15_000, 0, 600)),         // $0.0505
  line('turn_context', { turn_id: 't2', model: 'gpt-5.6-terra' }),
  record('t2', usage(100_000, 60_000, 30_000, 2_100)), // $0.1322, with cache writes
  record('t2', usage(300_000, 280_000, 0, 1_000)),     // $0.21, long-context rates
  line('turn_context', { turn_id: 't3', model: 'gpt-9' }),
  record('t3', usage(1_000, 0, 0, 100)),               // no price
  '{"type":"token_usage_record","payload":{"turn_id":"t3","usage":{"input_tok', // half-written
].join('\n'));

assert.equal(await run({ turn_id: 't2', model: 'gpt-5.6-terra', transcript_path: codex }), '$0.342 this response · $0.476 session (without gpt-9) · 400K in (85% cached) · 3.1K out');
assert.equal(await run({ turn_id: 't3', model: 'gpt-9', transcript_path: codex }), 'no price for gpt-9 · $0.476 session (without gpt-9) · 1K in (0% cached) · 100 out');

// Claude Code
const claudeLine = (type, fields) => JSON.stringify({ timestamp: '2026-10-22T10:00:00.000Z', type, ...fields });
const answer = (id, model, stop_reason, input_tokens, cache_read_input_tokens, write5m, write1h, output_tokens, extra) => claudeLine('assistant', {
  message: { id, model, stop_reason, usage: {
    input_tokens, cache_read_input_tokens, cache_creation_input_tokens: write5m + write1h,
    cache_creation: { ephemeral_5m_input_tokens: write5m, ephemeral_1h_input_tokens: write1h }, output_tokens, ...extra,
  } },
});

const claude = join(dir, 'session.jsonl');
writeFileSync(claude, [
  claudeLine('user', { promptId: 'p1' }),
  answer('m1', 'claude-sonnet-4-5-20250929', null, 2, 20_000, 0, 10_000, 8),         // written mid-stream
  answer('m1', 'claude-sonnet-4-5-20250929', 'tool_use', 2, 20_000, 0, 10_000, 300), // $0.0705, 1-hour cache write
  claudeLine('user', { promptId: 'p1' }),                                              // tool result
  answer('m2', 'claude-opus-5-5', 'end_turn', 2, 30_000, 1_000, 0, 500, { inference_geo: 'us' }), // $0.0231
  claudeLine('user', { promptId: 'p2' }),
  answer('m3', 'claude-haiku-5-5', 'tool_use', 20_000, 130_000, 0, 0, 100, { server_tool_use: { web_search_requests: 2 } }), // $0.0368, over 100K
  answer('x', '<synthetic>', 'end_turn', 0, 0, 0, 0, 0),
].join('\n') + '\n');

// Claude Code runs Stop before it writes the turn's last message.
const late = run({ prompt_id: 'p2', transcript_path: claude });
setTimeout(() => appendFileSync(claude, answer('m4', 'claude-opus-5-5', 'end_turn', 2, 40_000, 0, 0, 1_000, { speed: 'fast' })), 150); // $0.056
assert.equal(await late, '$0.093 this response · $0.186 session · 190K in (89% cached) · 1.1K out');
assert.equal(await run({ prompt_id: 'p1', transcript_path: claude }), '$0.094 this response · $0.186 session · 61K in (82% cached) · 800 out');

rmSync(dir, { recursive: true });
console.log('ok');
