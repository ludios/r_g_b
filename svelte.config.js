// Model-output: Claude Opus 5.5
import adapter from "@sveltejs/adapter-static";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// The one page is prerendered (see src/routes/+layout.ts), so the build
		// is plain files under build/ that any static host can serve.
		adapter: adapter(),
		paths: {
			// Set BASE_PATH=/some/prefix when the site is not served from the root.
			base: process.env.BASE_PATH ?? "",
		},
		output: {
			// One script and one stylesheet rather than a graph of chunks.
			bundleStrategy: "single",
		},
	},
};

export default config;
