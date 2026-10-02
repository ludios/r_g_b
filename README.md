<!-- Model-output: Claude Opus 5.5 -->
# r_g_b

A WebGL feedback loop that grows stripes from three dots, after v buckenham's
[r_g_b.html](https://v21.io/r_g_b.html). Each step, every pixel becomes a weighted sum of 25
pixels around it, then is clamped to 0–1; the weights sum to 1, but they amplify some stripes,
which grow until the clamp stops them. R, G and B are three copies of this.

A card in the corner holds the controls: the kernel (random by number, morphing into the next;
presets; dragged by hand), contrast, drift, tap spacing, jitter, persistence, speed, what a restart
starts from, how the image is shown, and what the mouse and clicks do. A map shows which stripes
the kernel grows. Everything that sets the look is in the address bar, so a URL is a recipe.
"Like r_g_b.html" plays as the original did, with the mouse.

## Layout

- `src/lib/sim.frag` — one step, a fresh start, or a brush stroke.
- `src/lib/screen.frag` — the latest frame on the canvas, one of several ways.
- `src/lib/simulation.ts` — `Simulation`: the three.js buffers and the passes over them.
- `src/lib/kernel.ts` — random kernels by seed and `Kernels`, which morphs them; presets; contrast,
  drift and the editing tools.
- `src/lib/spectrum.ts` — what a step does to each wave of stripes, ignoring the clamp, and the map
  of it.
- `src/lib/settings.ts` — the settings and their sliders; `codec.ts` — them and the kernel as a URL.
- `src/lib/KernelDiagram.svelte`, `GrowthMap.svelte`, `TapsOverlay.svelte` — the kernel's squares,
  the map, and where one pixel's taps land.
- `src/lib/theme.svelte.ts`, `storage.ts` — the light/dark override, as in diamond-maker.
- `src/routes/+page.svelte` — the canvas, the loop, and the card.
- `test/snapshot.py` — deterministic screenshots of a revision, to check a refactor changes
  nothing.

## Working on it

	pnpm install
	pnpm dev
	pnpm lint && pnpm check && pnpm test
	pnpm build                       # -> build/, plain files; BASE_PATH=/prefix when not served from the root
	test/snapshot.py HEAD /tmp/a && test/snapshot.py . /tmp/b && test/snapshot.py --diff /tmp/a /tmp/b
