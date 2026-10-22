// pennies-for-your-prompt: Codex Stop hook that shows what each response cost.
// Reads the transcript Codex already keeps on disk. No network, writes nothing.
// SPDX-License-Identifier: MIT-0
import { readFileSync } from 'node:fs';

// USD per 1M tokens, standard tier, from openai.com/api/pricing on 2026-10-22.
// Cache writes cost the input price unless listed. `long`: requests with more
// than 272K input tokens pay 2x on input and 1.5x on output.
const PRICES = {
  'gpt-5.6-sol':        { input: 4,    cached: 0.4,   cacheWrite: 5,    output: 20,  long: true },
  'gpt-5.6-terra':      { input: 2,    cached: 0.2,   cacheWrite: 2.5,  output: 12,  long: true },
  'gpt-5.6-luna':       { input: 0.2,  cached: 0.02,  cacheWrite: 0.25, output: 1.2, long: true },
  'gpt-5.5':            { input: 5,    cached: 0.5,   output: 30, long: true },
  'gpt-5.4':            { input: 2.5,  cached: 0.25,  output: 15, long: true },
  'gpt-5.4-mini':       { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5.3-codex':      { input: 1.75, cached: 0.175, output: 14 },
  'gpt-5.2':            { input: 1.75, cached: 0.175, output: 14 },
  'gpt-5.2-codex':      { input: 1.75, cached: 0.175, output: 14 },
  'gpt-5.1':            { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5.1-codex':      { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5.1-codex-max':  { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5.1-codex-mini': { input: 0.25, cached: 0.025, output: 2 },
  'gpt-5':              { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5-codex':        { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5-mini':         { input: 0.25, cached: 0.025, output: 2 },
};

// One model response. input_tokens already includes cached reads and cache writes.
function cost(price, u) {
  const write = u.cache_write_input_tokens ?? 0;
  const fresh = u.input_tokens - u.cached_input_tokens - write;
  const long = price.long && u.input_tokens > 272_000;
  const inputSide = fresh * price.input + u.cached_input_tokens * price.cached + write * (price.cacheWrite ?? price.input);
  return ((long ? 2 : 1) * inputSide + (long ? 1.5 : 1) * u.output_tokens * price.output) / 1e6;
}

const usd = (x) => '$' + x.toFixed(x < 1 ? 3 : 2);
const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format;

try {
  const hook = JSON.parse(readFileSync(0, 'utf8'));
  if (!hook.transcript_path) process.exit(0);

  const modelOf = new Map(); // turn_id -> model
  const unpriced = new Set();
  const turn = { found: false, cost: 0, input: 0, cached: 0, output: 0 };
  let session = 0, records = 0;

  // Reads the whole transcript every turn; fine up to tens of MB.
  for (const line of readFileSync(hook.transcript_path, 'utf8').split('\n')) {
    if (!line.includes('"type":"turn_context"') && !line.includes('"type":"token_usage_record"')) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; } // a line Codex is still writing
    const p = item.payload;
    if (item.type === 'turn_context') {
      if (p.turn_id) modelOf.set(p.turn_id, p.model);
      continue;
    }
    if (item.type !== 'token_usage_record') continue;
    records++;
    const model = modelOf.get(p.turn_id) ?? hook.model;
    const c = PRICES[model] ? cost(PRICES[model], p.usage) : 0;
    if (!PRICES[model]) unpriced.add(model);
    session += c;
    if (p.turn_id === hook.turn_id) {
      turn.found = true;
      turn.cost += c;
      turn.input += p.usage.input_tokens;
      turn.cached += p.usage.cached_input_tokens;
      turn.output += p.usage.output_tokens;
    }
  }

  let msg;
  if (!records) {
    msg = 'pennies-for-your-prompt: no token usage in this transcript (needs Codex from September 2026 or later)';
  } else if (turn.found) {
    const model = modelOf.get(hook.turn_id) ?? hook.model;
    const cachedPct = turn.input ? Math.round((100 * turn.cached) / turn.input) : 0;
    msg = [
      PRICES[model] ? `${usd(turn.cost)} this response` : `no price for ${model}`,
      `${usd(session)} session` + (unpriced.size ? ` (without ${[...unpriced].join(', ')})` : ''),
      `${count(turn.input)} in (${cachedPct}% cached)`,
      `${count(turn.output)} out`,
    ].join(' · ');
  }
  if (msg) process.stdout.write(JSON.stringify({ systemMessage: msg }));
} catch (err) {
  process.stdout.write(JSON.stringify({ systemMessage: `pennies-for-your-prompt failed: ${err.message}` }));
}
