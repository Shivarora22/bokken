# Contributing to bokken

Thanks for wanting to help. bokken is a personal hobby project, and issues and pull requests are welcome. For anything bigger than a small fix, open an issue first so we can agree on it before you spend time on it.

## Setup

You need [Node.js](https://nodejs.org) 22.13 or newer.

```sh
git clone https://github.com/Shivarora22/bokken.git
cd bokken
npm install     # also builds it
npm link        # puts your copy on your PATH as `bokken`
```

After a change, run `npm run build` and try it with `bokken`.

- **Keep your own data out of the way:** `BOKKEN_HOME=/tmp/bokken-dev bokken` uses a separate folder for the settings, credentials and database.
- **Try one way of opening the editor:** `BOKKEN_SPLIT=tmux|wezterm|wt|none bokken` forces it.

## Live checks

These talk to real services, so run them when you change the code they cover:

- `npm run smoke` asks LeetCode for today's problem, the problem list, one problem and one topic page (four requests). Run it after changing `src/leetcode.js`.
- `npm run check:ai` tries the coach against your bokken AI setup: classifying a question, a hint and a streamed explanation. Name a provider to use its usual environment variable instead, such as `npm run check:ai -- gemini`, or `npm run check:ai -- ollama qwen3:8b` for a local model. On a cloud provider it costs a few cents at most.

## Where things are

| Path | What's there |
|---|---|
| `src/cli.js`, `src/main.js` | The command line |
| `src/app/` | The full-screen app (Ink and React) |
| `src/ai/` | The AI coach: its prompts, and an adapter for Anthropic and one for everything OpenAI-compatible |
| `src/leetcode.js` | Everything that talks to LeetCode |
| `src/tracking.js`, `src/stats.js` | The clock, attempts and practice analytics |
| `src/editor.js`, `src/split.js` | Finding your editor and opening it in a split |
| `src/languages.js` | How a solution file is written in each language |
| `src/db.js` | The SQLite database in `~/.bokken` |

Common changes:

- **A new AI provider:** add a preset to `PROVIDERS` in `src/ai/providers.js`. Most providers speak the OpenAI API, so a name, a base URL and the key's environment variable are usually enough.
- **A new language:** add it to `LANGUAGES` in `src/languages.js`.
- **A new terminal for splits:** `src/split.js`.

## Ground rules

These matter more than style:

- **Ask LeetCode for as little as possible.** Keep what you fetch, never send requests in the background or while bokken is closed, and stop instead of retrying when LeetCode asks you to slow down. Don't disguise requests as a browser.
- **Nothing leaves the user's computer** except requests to leetcode.com and to the user's own AI provider. No telemetry or analytics.
- **AI stays optional.** Everything except the coach works without it.
- **Problem statements aren't saved** in the solutions folder: it holds only the user's code.
- **Never log or print** a LeetCode session or an API key.

## Style

- Plain JavaScript modules (ESM), with JSDoc where types help. esbuild bundles everything into `dist/`.
- Dependencies are pinned to exact versions and bundled, so the published package installs nothing else. Ask in an issue before adding one.
- Comments say why, not what, and stay short.
- Anything the user reads (messages, help, the README) is plain English: short sentences, no jargon, and it says what to do next.
- Match the code around you.

## Pull requests

- One change per pull request, kept small.
- Say what you changed and how you tried it: your OS and terminal, and your AI provider if it touches the coach.
- If you changed how the editor or splits work, try it in the terminals it affects: tmux, Windows Terminal, WezTerm, and a plain terminal.
- Commit messages start with `[ADD]`, `[FIX]` or `[UPDATE]`, like the existing history.

## Reporting a bug

Open an [issue](https://github.com/Shivarora22/bokken/issues) with:

- `bokken --version`, your OS and your terminal
- `bokken ai status`, if it's about the coach
- what you did, what you expected, and what happened

Never paste `~/.bokken/credentials.json`, your LeetCode session or an API key.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
