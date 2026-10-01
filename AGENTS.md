# Environment

Welcome. You're on NixOS 26.05 and many things are already installed, including:

ripgrep, ripgrep-all, node, deno, pnpm, oxfmt, oxlint, jq, python3, uv, psql, ephemeralpg (bin: pg_tmp), google-chrome, curl-impersonate, gcc, go, rustc, cargo, patchelf, zip, unzip, zstd, dmesg, perf, hyperfine, codex, claude.

Before starting or resuming work, check what `hostname` outputs.

- If it ends in "clank", run whatever commands you need.
- Otherwise, stop and ask the user to edit this file.

When waiting on something, generally don't use `sleep N` where N > 10; use the built-in task watching, or e.g. `wait-for-process-exit PID`, or loop something e.g. `rg -q PATTERN FILE` with a 2 second wait.

If git objects are broken: don't investigate, just try again in 7 seconds; if still broken: AskUserQuestion "Have you fixed it yet?" Y/N.

# There's plenty of time

If more external information is needed, think and keep iterating on web search queries to thoroughly check things. Tips: try site-specific searches e.g. site:github.com, reddit.com, news.ycombinator.com; try combinations of quoted items.

If you can't fetch something, use google-chrome or curl_chrome150 on this machine.

# After making changes

Never `git commit -a` because there may be others working; stage changes manually.

Then automatically commit your changes with this commit template:

	subsystem: short one-line description; semicolon if multiple changes

	Model-output: model name e.g. Claude Fable 5.1

	<prompt>

	user prompt, verbatim

	AskUserQuestion question-answers, if any

	</prompt>

	<slop>

	model's response at the end of the dialogue, verbatim, in markdown format

	</slop>

"(mid-turn)" if user added something mid-turn; multiple &lt;prompt>&lt;/prompt> &lt;slop>&lt;/slop> ... if the conversation had several real turns.

If acting on code reviews from Codex, Claude, or some other agent, inside the beginning of &lt;slop>, add one per review:

	<review model="model e.g. gpt-6-astra" reasoning_effort="effort e.g. xhigh">

	...

	</review>

# Code review after each commit

After each commit you make, get it reviewed by Codex and by Claude, all at xhigh reasoning:

	codex review --commit <sha> -c model="gpt-6-astra" -c model_reasoning_effort="xhigh"
	codex review --commit <sha> -c model="gpt-6.1-sol" -c model_reasoning_effort="xhigh"
	claude -p --model claude-fable-5-1 --effort xhigh "/code-review xhigh commit <sha>"
	claude -p --model claude-opus-5-5 --effort xhigh "/code-review xhigh commit <sha>"

Notes:

- If you made several commits, ensure reviews cover them all: either review each commit, or, a whole batch:
	- codex: replace `--commit <sha>` with `--base <sha before your first commit>`
	- claude: replace `commit <sha>` with `commits <sha before your first commit>..<sha of your last commit>`
- Codex is already configured globally to never ask for permission and run unsandboxed.
- A review can take several minutes; start them all in the background. Reviewers read the working tree, so don't edit files until the reviews are in.
- Review findings are from **fallible machines eager to find issues**: think and prefer fixes that don't add a bunch of code we don't really need.
- Once all the reviews are in, fix the oversights that are really worth fixing, in one or more commits. If nothing, say briefly why the findings didn't warrant changes.
- Do _not_ send follow-up fixes through another review. (Exception: the follow-up grew into something substantial beyond addressing the findings.)

# Thank you for your hard work on this project

<3
