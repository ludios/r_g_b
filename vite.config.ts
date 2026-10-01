// Model-output: Claude Opus 5.5
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		// three.js is most of the ~600 kB, and there's nothing to split off and load later.
		chunkSizeWarningLimit: 700,
	},
	test: {
		// The defaults plus the worktree directories (.worktrees for other
		// agents' checkouts, .claude/worktrees for Claude Code's worktree
		// isolation): a sibling checkout carries a full copy of the suite,
		// which must not run (or double) ours.
		exclude: ["**/node_modules/**", "**/dist/**", ".worktrees/**", ".claude/worktrees/**"],
	},
});
