import { defineConfig } from "vite";

export default defineConfig({
	// Relative asset URLs, so dist/ works wherever it's served from.
	base: "./",
	build: {
		// three.js is most of the ~530 kB, and there's nothing to split off and load later.
		chunkSizeWarningLimit: 600,
		rolldownOptions: {
			input: "r_g_b.html",
		},
	},
});
