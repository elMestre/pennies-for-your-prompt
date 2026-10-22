// pennies-for-your-prompt: Codex and Claude Code Stop hook that shows what each response cost.
// Reads the transcript the agent already keeps on disk. No network, writes nothing.
// SPDX-License-Identifier: MIT-0
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

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

// USD per 1M tokens, from platform.claude.com/docs/en/about-claude/pricing on 2026-10-22.
// Cache writes cost 1.25x input (5-minute) or 2x (1-hour). `long`: rates for
// prompts over 100K tokens, cache included.
const CLAUDE_PRICES = {
  'claude-fable-5-1':  { input: 10,  cached: 0.25, output: 50 },
  'claude-mythos-5-1': { input: 10,  cached: 0.25, output: 50 },
  'claude-fable-5':    { input: 10,  cached: 1,    output: 50 },
  'claude-mythos-5':   { input: 10,  cached: 1,    output: 50 },
  'claude-opus-5-5':   { input: 4,   cached: 0.2,  output: 20 },
  'claude-opus-5':     { input: 5,   cached: 0.5,  output: 25 },
  'claude-opus-4-8':   { input: 5,   cached: 0.5,  output: 25 },
  'claude-opus-4-7':   { input: 5,   cached: 0.5,  output: 25 },
  'claude-opus-4-6':   { input: 5,   cached: 0.5,  output: 25 },
  'claude-opus-4-5':   { input: 5,   cached: 0.5,  output: 25 },
  'claude-sonnet-5-5': { input: 2,   cached: 0.1,  output: 10 },
  'claude-sonnet-5':   { input: 2,   cached: 0.2,  output: 10 },
  'claude-sonnet-4-6': { input: 3,   cached: 0.3,  output: 15 },
  'claude-sonnet-4-5': { input: 3,   cached: 0.3,  output: 15 },
  'claude-haiku-5-5':  { input: 0.1, cached: 0.01, output: 0.5, long: { input: 0.5, cached: 0.05, output: 2.5 } },
  'claude-haiku-4-5':  { input: 1,   cached: 0.1,  output: 5 },
};

// One Codex model response. input_tokens already includes cached reads and cache writes.
function codexCost(price, u) {
  const write = u.cache_write_input_tokens ?? 0;
  const fresh = u.input_tokens - u.cached_input_tokens - write;
  const long = price.long && u.input_tokens > 272_000;
  const inputSide = fresh * price.input + u.cached_input_tokens * price.cached + write * (price.cacheWrite ?? price.input);
  return ((long ? 2 : 1) * inputSide + (long ? 1.5 : 1) * u.output_tokens * price.output) / 1e6;
}

// One Claude model response. Here input_tokens leaves out cache reads and writes.
// Fast mode costs 2x on every model that has it, US-only inference 1.1x, web searches $10 per 1K.
function claudeCost(price, u) {
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const write1h = Math.min(u.cache_creation?.ephemeral_1h_input_tokens ?? 0, write);
  const p = price.long && u.input_tokens + read + write > 100_000 ? price.long : price;
  const tokens = u.input_tokens * p.input + read * p.cached + (write - write1h) * 1.25 * p.input + write1h * 2 * p.input + u.output_tokens * p.output;
  const premium = (u.speed === 'fast' ? 2 : 1) * (u.inference_geo === 'us' ? 1.1 : 1);
  return (premium * tokens) / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * 0.01;
}

// Codex: one token_usage_record line per response; the model comes from the turn's turn_context.
function codexResponses(lines, hook) {
  const modelOf = new Map(); // turn_id -> model
  const responses = [];
  for (const line of lines) {
    if (!line.includes('"type":"turn_context"') && !line.includes('"type":"token_usage_record"')) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; } // a line Codex is still writing
    const p = item.payload;
    if (item.type === 'turn_context') {
      if (p.turn_id) modelOf.set(p.turn_id, p.model);
    } else if (item.type === 'token_usage_record') {
      const model = modelOf.get(p.turn_id) ?? hook.model, u = p.usage;
      responses.push({
        model, inTurn: p.turn_id === hook.turn_id, cost: PRICES[model] && codexCost(PRICES[model], u),
        input: u.input_tokens, cached: u.cached_input_tokens, output: u.output_tokens,
      });
    }
  }
  return responses;
}

// Claude Code: one line per content block, and the last one has the final usage.
// User lines carry the promptId; the assistant lines after them answer that prompt.
function claudeResponses(lines, hook) {
  const byId = new Map(); // message id -> { message, prompt }
  let prompt;
  for (const line of lines) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; } // a line Claude Code is still writing
    if (item.type === 'user') prompt = item.promptId ?? prompt;
    else if (item.type === 'assistant' && item.message?.usage && item.message.model !== '<synthetic>') {
      byId.set(item.message.id, { message: item.message, prompt });
    }
  }
  return [...byId.values()].map(({ message: m, prompt: p }) => {
    const model = m.model.replace(/-\d{8}$/, ''), u = m.usage; // claude-haiku-4-5-20251001
    const read = u.cache_read_input_tokens ?? 0;
    return {
      model, inTurn: p !== undefined && p === hook.prompt_id, cost: CLAUDE_PRICES[model] && claudeCost(CLAUDE_PRICES[model], u),
      input: u.input_tokens + read + (u.cache_creation_input_tokens ?? 0), cached: read, output: u.output_tokens,
      done: m.stop_reason != null && m.stop_reason !== 'tool_use',
    };
  });
}

const usd = (x) => '$' + x.toFixed(x < 1 ? 3 : 2);
const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format;

try {
  const hook = JSON.parse(readFileSync(0, 'utf8'));
  if (!hook.transcript_path) process.exit(0);

  // Codex sends a turn_id, Claude Code a prompt_id. Rereads the whole transcript; fine up to tens of MB.
  const read = () => (hook.turn_id ? codexResponses : claudeResponses)(readFileSync(hook.transcript_path, 'utf8').split('\n'), hook);
  let responses = read();
  // Claude Code runs Stop just before the turn's last message reaches the transcript
  // (it writes every 100 ms), so wait up to a second for it.
  for (let i = 0; hook.prompt_id && !responses.findLast((r) => r.inTurn)?.done && i < 20; i++) {
    await sleep(50);
    responses = read();
  }

  const unpriced = new Set();
  const turn = { found: false, model: undefined, cost: 0, input: 0, cached: 0, output: 0 };
  let session = 0;
  for (const r of responses) {
    if (r.cost === undefined) unpriced.add(r.model);
    session += r.cost ?? 0;
    if (!r.inTurn) continue;
    turn.found = true;
    turn.model = r.model;
    turn.cost += r.cost ?? 0;
    turn.input += r.input;
    turn.cached += r.cached;
    turn.output += r.output;
  }

  let msg;
  if (!responses.length) {
    msg = 'pennies-for-your-prompt: no token usage in this transcript' + (hook.turn_id ? ' (needs Codex from September 2026 or later)' : '');
  } else if (turn.found) {
    const cachedPct = turn.input ? Math.round((100 * turn.cached) / turn.input) : 0;
    msg = [
      unpriced.has(turn.model) ? `no price for ${turn.model}` : `${usd(turn.cost)} this response`,
      `${usd(session)} session` + (unpriced.size ? ` (without ${[...unpriced].join(', ')})` : ''),
      `${count(turn.input)} in (${cachedPct}% cached)`,
      `${count(turn.output)} out`,
    ].join(' · ');
  }
  if (msg) process.stdout.write(JSON.stringify({ systemMessage: msg }));
} catch (err) {
  process.stdout.write(JSON.stringify({ systemMessage: `pennies-for-your-prompt failed: ${err.message}` }));
}
