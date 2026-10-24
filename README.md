```
██████╗  ██████╗ ██╗  ██╗██╗  ██╗███████╗███╗   ██╗
██╔══██╗██╔═══██╗██║ ██╔╝██║ ██╔╝██╔════╝████╗  ██║
██████╔╝██║   ██║█████╔╝ █████╔╝ █████╗  ██╔██╗ ██║
██╔══██╗██║   ██║██╔═██╗ ██╔═██╗ ██╔══╝  ██║╚██╗██║
██████╔╝╚██████╔╝██║  ██╗██║  ██╗███████╗██║ ╚████║
╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝
```
Practice coding problems in your terminal, with a live timer, hints and an optional AI coach next to your own editor.

Run `bokken` and you get a full-screen practice app: the problem, a timer that only counts the time you're actually working, and a coach. Your own terminal editor opens in a split right next to it. bokken also keeps track of how you practice: time per problem, by topic and difficulty, where you struggle, and what to work on next.

LeetCode is the first problem source. bokken is unofficial and not affiliated with LeetCode.

## What works with what

Nothing needs setting up first. Each optional step unlocks more:

| Feature | No setup | + AI provider | + LeetCode login |
|---|:-:|:-:|:-:|
| Problems, the live timer, your editor in a split | ✓ | ✓ | ✓ |
| LeetCode's official hints | ✓ | ✓ | ✓ |
| Time tracking, stats by topic and difficulty, "what next" suggestions | ✓ | ✓ | ✓ |
| AI coach: deeper hints, explanations, chat, the solution when you ask for it | | ✓ | |
| `/run` and `/submit` on LeetCode | | | ✓ |
| Problems you solved on leetcode.com marked as solved in `/next` and `/browse` | | | ✓ |

When something needs a missing piece, bokken says so and tells you the command that adds it.

## Install

You need [Node.js](https://nodejs.org) 22.13 or newer.

```sh
npm install -g @shiotagi/bokken
```

The command is `bokken`. To update, run `npm install -g @shiotagi/bokken@latest`. To remove it, run `npm uninstall -g @shiotagi/bokken`; your settings stay in `~/.bokken` and your solutions in their folder.

**To work on bokken itself:**

```sh
git clone https://github.com/Shivarora22/bokken.git
cd bokken
npm install     # also builds it
npm link        # puts the `bokken` command on your PATH
```

## Quick start

```sh
bokken
```

The first run asks for three things: your language, your terminal editor and a folder for your solutions (`~/leetcode-solutions` by default). Change them later with `/setup`.

Then:

1. Type `/today` for today's problem, or `/open 1` (a number, slug, title or link).
2. Press `ctrl+e` to open the solution file in your editor.
3. Write your code and save. Type `/hint` when you're stuck.
4. Type `/run` to try the examples and `/submit` to submit (both need `/login`), or `/done` to mark it solved yourself.

## Your editor, next to bokken

bokken doesn't draw the split itself. It asks your terminal to split the window:

| Where you run it | What `ctrl+e` does |
|---|---|
| **tmux** (macOS, Linux, over SSH) | Opens your editor in a tmux split |
| **Windows Terminal** (PowerShell or WSL) | Opens your editor in a split pane |
| **WezTerm** | Opens your editor in a split pane |
| **Any other terminal** | Hands the whole screen to your editor. The timer keeps running in the tab's title |

Switch between the panes the way you normally do (tmux keys, Alt+arrows in Windows Terminal).

**Each problem gets its own editor.** Leaving a problem (`/home`, `/open` another one, `/stats`, `/browse`, `/setup`) closes the editor bokken opened for it, and the next problem opens a new one. Quitting with the editor open asks first. Save before you leave: vim and nvim keep unsaved changes in their swap file, but on Windows they're lost.

**Which editor:** the one you chose in setup, then `$VISUAL` or `$EDITOR`, then the first of nvim, vim, helix, micro, nano, `edit` (Windows) and vi that's installed. Only terminal editors are supported for now; GUI editors like VS Code are skipped. If none is installed, bokken offers to install micro for you (`ctrl+s` saves, `ctrl+q` quits), and only runs the install if you say yes.

## Commands

### In the app

| Command | What it does |
|---|---|
| `/today` | Today's problem |
| `/open <problem>` | A problem by number, slug, title or link |
| `/hint` | The next hint: LeetCode's own first, then the AI's |
| `/run` | Run your code on the examples, on LeetCode |
| `/submit` | Submit your code to LeetCode; Accepted marks it solved |
| `/done` | Mark it solved and stop the clock |
| `/next [topic]` | What to practice next, and why |
| `/stats [view]` | Your numbers: `topics`, `difficulty`, `trend`, or a problem |
| `/browse [filters]` | Problems to pick from, e.g. `/browse dp medium unsolved` |
| `/random [filters]` | Open a random problem that matches |
| `/new` | Start a fresh chat with the coach |
| `/ai` | Set up the AI coach |
| `/login`, `/logout` | Save or forget your LeetCode login |
| `/setup` | Change your language, editor or folder |
| `/home`, `/help`, `/quit` | |

Anything you type that isn't a command goes to the coach.

**Keys:** `ctrl+e` opens your editor · `tab` switches between the problem and the coach · `PgUp`/`PgDn` scroll · `Esc` stops an answer · `↑`/`↓` earlier commands · `ctrl+c` quits (with your editor open, it asks first).

### From the shell

| Command | What it does |
|---|---|
| `bokken` | Open the app |
| `bokken today`, `bokken open <problem>` | Open the app on a problem |
| `bokken setup` | Choose your language, editor and solutions folder |
| `bokken login`, `bokken logout` | Save or forget your LeetCode login |
| `bokken ai setup` | Choose an AI provider, key and model |
| `bokken ai status [--check]` | Show the AI provider and model; `--check` also tests the key and model |
| `bokken ai off` | Turn AI off and delete a key bokken saved |
| `bokken stats [view] [--json]` | Your practice numbers, with no requests to LeetCode |
| `bokken list [filters] [--json]` | Problems that match, e.g. `bokken list easy dp unsolved` |

**Filters** go in any order: a difficulty (`easy`, `medium`, `hard`), a status (`solved`, `unsolved`, `tried`) and a topic, by name or short name (`dp`, `bfs`, `heap`, `binary search`). Premium-only problems are left out for now.

## Practice analytics

bokken records your attempts on your own computer and works out the numbers from them. `/stats` and `bokken stats` never contact LeetCode.

- **Active time:** the timer counts the gaps between things you do, each capped at 10 minutes, so a lunch break doesn't count as working on a problem.
- **Views:** an overview, topics (weakest first), difficulty, an 8-week trend, and every attempt at one problem.
- **Weakest topics:** your median time on a topic compared with your usual time at that difficulty, plus wrong submissions and help used. A topic needs at least 3 solves before it gets a score.
- **`/next`:** picks a problem from your weakest topic, at a difficulty you're ready for, and says why. The home screen shows the same suggestion.

## AI coach (optional)

Bring your own provider:

- **Anthropic (Claude)**, **OpenAI**, **Google Gemini**
- **Local:** Ollama, vLLM, LM Studio
- **Any OpenAI-compatible server:** OpenRouter, Groq, Together, DeepSeek…

Run `/ai` (or `bokken ai setup`) to choose one. bokken uses your key from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` if it's set, or saves a key you paste in `~/.bokken/credentials.json`.

**How it coaches:** hints come in steps, starting with LeetCode's own hints, and never contain code. Ask anything about the problem or your code in plain words. The full solution comes only when you ask for it and confirm, and the attempt is then marked as "viewed solution" in your stats.

**What goes to your AI provider:**

| When | Sent | Not sent |
|---|---|---|
| Hints and questions | The problem, its official hints, your code (between the markers), earlier hints, your question | Anything else from your computer |
| Deciding what kind of question you asked | Your question, plus how many hints you've used and whether you've written code | The problem text, your code |

Your LeetCode login is never sent. With Ollama, vLLM or LM Studio on your own machine, nothing leaves it. On a hosted provider, check its data terms: Google's free Gemini API tier, for example, may use your prompts to improve its products.

## Your solutions folder

```
~/leetcode-solutions/
└── 1-two-sum/
    ├── .bokken.json        # which problem this is
    └── solution.py
```

- **An existing solution file is never overwritten.** Opening the problem in another language adds a second file.
- **Only the code between the markers is sent** to `/run` and `/submit`. Above them goes whatever your machine needs to compile or lint the file, such as imports.
- **The folder holds only your code.** Problem statements aren't saved there, so you can push it to GitHub as it is.

```python
# 1. Two Sum [Easy] · https://leetcode.com/problems/two-sum/

from typing import List

# @bokken code=start
class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        pass
# @bokken code=end
```

## Files and settings

```
~/.bokken/                  # move it with BOKKEN_HOME
├── config.json             # language, editor, solutions folder, AI provider and model
├── credentials.json        # LeetCode login and AI key, if saved
└── bokken.db               # problem cache, your attempts and stats
```

## License

[MIT](LICENSE)
