// Run: node test.mjs. Feeds pennies.mjs a made-up transcript and checks the message.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = (input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens) => ({
  input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens,
  reasoning_output_tokens: 0, total_tokens: input_tokens + output_tokens,
});
const line = (type, payload) => JSON.stringify({ timestamp: '2026-10-22T10:00:00.000Z', type, payload });
const record = (turn_id, u) => line('token_usage_record', { turn_id, root_turn_id: turn_id, response_id: 'r', usage: u });

const dir = mkdtempSync(join(tmpdir(), 'pennies-'));
const transcript_path = join(dir, 'rollout.jsonl');
writeFileSync(transcript_path, [
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

const run = (turn_id, model) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('pennies.mjs', import.meta.url))], {
  input: JSON.stringify({ session_id: 's1', turn_id, transcript_path, cwd: dir, hook_event_name: 'Stop', model }),
})).systemMessage;

assert.equal(run('t2', 'gpt-5.6-terra'), '$0.342 this response · $0.476 session (without gpt-9) · 400K in (85% cached) · 3.1K out');
assert.equal(run('t3', 'gpt-9'), 'no price for gpt-9 · $0.476 session (without gpt-9) · 1K in (0% cached) · 100 out');
rmSync(dir, { recursive: true });
console.log('ok');
