# pennies-for-your-prompt

A [Codex](https://github.com/openai/codex) and [Claude Code](https://code.claude.com) hook that tells you what each response cost.

After every answer, you get a line like:

```
$0.342 this response · $0.476 session · 400K in (85% cached) · 3.1K out
```

These are estimates at API list prices: OpenAI's for Codex, Anthropic's for Claude Code. On a ChatGPT or Claude subscription you don't pay per token, so read them as "what this would have cost on the API".

**Status: v0.2, work in progress.** Prices are hardcoded in the script, and it rereads the whole transcript after every response.

## Install

You need Node.js.

### Codex

You also need a Codex release from September 2026 or later.

1. Save `pennies.mjs` in your Codex folder.

   macOS / Linux:

   ```sh
   curl -fsSLo ~/.codex/pennies.mjs https://raw.githubusercontent.com/elMestre/pennies-for-your-prompt/main/pennies.mjs
   ```

   Windows (PowerShell):

   ```powershell
   iwr https://raw.githubusercontent.com/elMestre/pennies-for-your-prompt/main/pennies.mjs -OutFile "$HOME\.codex\pennies.mjs"
   ```

2. Add the hook to `~/.codex/hooks.json` (create the file if it doesn't exist, or merge into the one you have):

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "node \"$HOME/.codex/pennies.mjs\"",
               "commandWindows": "node \"%USERPROFILE%\\.codex\\pennies.mjs\"",
               "timeout": 10
             }
           ]
         }
       ]
     }
   }
   ```

3. Start Codex, run `/hooks` and trust the new hook. Codex skips hooks you haven't trusted, and asks again if the hook changes.

If you set `CODEX_HOME`, use that folder instead of `~/.codex`.

### Claude Code

1. Save `pennies.mjs` in your Claude folder.

   macOS / Linux:

   ```sh
   curl -fsSLo ~/.claude/pennies.mjs https://raw.githubusercontent.com/elMestre/pennies-for-your-prompt/main/pennies.mjs
   ```

   Windows (PowerShell):

   ```powershell
   iwr https://raw.githubusercontent.com/elMestre/pennies-for-your-prompt/main/pennies.mjs -OutFile "$HOME\.claude\pennies.mjs"
   ```

2. Add the hook to `~/.claude/settings.json` (merge it into the `hooks` you already have):

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "node \"$HOME/.claude/pennies.mjs\"",
               "timeout": 10
             }
           ]
         }
       ]
     }
   }
   ```

   The same command works on Windows, where Claude Code runs hooks with Git Bash or PowerShell.

3. Start a new Claude Code session.

If you set `CLAUDE_CONFIG_DIR`, use that folder instead of `~/.claude`.

## How it works

Codex and Claude Code write each session to a transcript file, including the token usage of every model response. When a response ends, they run this hook and pass it the transcript path and the id of the turn (Codex) or prompt (Claude Code). The script adds up that turn's usage, prices it, and hands back a message to display.

Claude Code runs the hook a moment before it writes the last message to the transcript, so the script waits for it: usually under a tenth of a second, a second at most.

No network, no dependencies, and it never writes anything. It's one file, so read it before you install it.

## Prices

Rates live at the top of `pennies.mjs`, in USD per million tokens:

- `PRICES`, for Codex, from [OpenAI's pricing page](https://developers.openai.com/api/docs/pricing) (checked 2026-10-22). Requests over 272K input tokens get long-context rates where the model has them. Not applied: priority, flex and batch tiers, and the 12-hour cache-write rate (the 30-minute rate is used).
- `CLAUDE_PRICES`, for Claude Code, from [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing) (checked 2026-10-22). Applied: 5-minute and 1-hour cache writes, Haiku 5.5's rates for prompts over 100K tokens, fast mode, US-only inference and web searches.

If your model is missing, you'll see `no price for <model>`. Add a line to the table, and please send a pull request.

## Limitations

- Subagent work isn't counted; subagents keep their own transcripts.
- Some Claude Code calls never reach the transcript, such as the one WebFetch makes to read a page, so `/cost` can come out slightly higher.
- The transcript formats are internal to Codex and Claude Code and may change between releases.

## Test

```sh
node test.mjs
```

## License

[MIT No Attribution](LICENSE): no credit needed. Claude Code wrote most of it, and it didn't ask for any either.

<img src="i-made-this.jpg" width="220" alt="Three-panel comic. One character holds out an object and says 'I made this'. The other asks 'You made this?', takes it, and says 'I made this'.">

<sub>Comic: [The Internet](https://nedroidcomics.tumblr.com/post/41879001445/the-internet) by Nedroid (Anthony Clark), 2013. Not covered by the license.</sub>

---

Not affiliated with or endorsed by OpenAI or Anthropic. Codex is a trademark of OpenAI; Claude is a trademark of Anthropic.
