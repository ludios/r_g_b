// Model-output: Claude Opus 5.5

import { configure, getConsoleSink } from "@logtape/logtape";

// Logging goes to the browser console; nothing here has a server to send it to.
await configure({
	sinks:   { console: getConsoleSink() },
	loggers: [
		{ category: "r_g_b", lowestLevel: "info", sinks: ["console"] },
		{ category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
	],
});
