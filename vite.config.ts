import { defineConfig } from "vite";

export default defineConfig({
	// Relative asset URLs, so dist/ works wherever it's served from.
	base: "./",
	build: {
		rolldownOptions: {
			input: "r_g_b.html",
		},
	},
});
