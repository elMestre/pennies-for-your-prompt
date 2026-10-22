# pennies-for-your-prompt

A [Codex](https://github.com/openai/codex) hook that tells you what each response cost.

After every answer, Codex shows a line like:

```
$0.342 this response · $0.476 session · 400K in (85% cached) · 3.1K out
```

These are estimates at OpenAI API list prices. On a ChatGPT plan you don't pay per token, so read them as "what this would have cost on the API".

**Status: v0.1, work in progress.** Prices are hardcoded in the script, and it rereads the whole transcript after every response.

## Install

You need Node.js and a Codex release from September 2026 or later.

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

## How it works

Codex writes each session to a transcript file, including the token usage of every model response. When a response ends, Codex runs this hook and passes it the transcript path and the turn id. The script adds up that turn's usage, prices it, and hands Codex a message to display.

No network, no dependencies, and it never writes anything. It's one short file, so read it before you install it.

## Prices

Rates live in `PRICES` at the top of `pennies.mjs`, in USD per million tokens, from [OpenAI's pricing page](https://developers.openai.com/api/docs/pricing) (checked 2026-10-22). Requests over 272K input tokens get long-context rates where the model has them.

Not applied: priority, flex and batch tiers, and the 12-hour cache-write rate (the 30-minute rate is used).

If your model is missing, Codex will show `no price for <model>`. Add a line to `PRICES`, and please send a pull request.

## Limitations

- Subagent work isn't counted; subagents keep their own transcripts.
- The transcript format is internal to Codex and may change between releases.

## Test

```sh
node test.mjs
```

## License

[MIT No Attribution](LICENSE): no credit needed. Claude Code wrote most of it, and it didn't ask for any either.

<img src="i-made-this.jpg" width="220" alt="Three-panel comic. One character holds out an object and says 'I made this'. The other asks 'You made this?', takes it, and says 'I made this'.">

<sub>Comic: [The Internet](https://nedroidcomics.tumblr.com/post/41879001445/the-internet) by Nedroid (Anthony Clark), 2013. Not covered by the license.</sub>

---

Not affiliated with or endorsed by OpenAI. Codex is a trademark of OpenAI.
