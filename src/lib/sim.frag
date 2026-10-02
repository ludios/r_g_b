// One simulation step, a fresh start, or a brush stroke. Needs WebGL2 (uint, floatBitsToUint); three.js's
// WebGL2 prefix #defines gl_FragColor. Alpha records which channels the clamp changed, as bits
// R=1, G=2, B=4 over 255.
uniform vec2 res;             // Buffer size in pixels
uniform sampler2D prev_frame;
uniform sampler2D seeds;      // The seed canvas
uniform bool stamp;           // Whether to re-stamp the seeds
uniform float kernel[25];     // Row-major 5x5 weights, summing to 1
uniform float tap_spacing;    // In pixels
uniform float jitter;         // Each pixel scales its tap spacing by 1 +/- up to this
uniform float persistence;    // How much of the previous frame to keep, -1 to 1
uniform bool starting;        // Whether to start afresh rather than step: the ground, noise and seeds
uniform float ground;         // The gray to start from
uniform float noise;          // How far each channel of each pixel starts from the ground, at most
uniform vec3 wave;            // Stripes to start with: cycles per pixel across and up, and amplitude
uniform bool painting;        // Whether to copy the previous frame with a stroke of the brush on it
uniform vec4 stroke;          // From (x, y) to (z, w), in pixels
uniform float brush;          // The stroke's radius in pixels
uniform vec3 paint;           // The stroke's color

// noise from http://amindforeverprogramming.blogspot.com/2013/07/random-floats-in-glsl-330.html
uint hash(uint x) {
	x += (x << 10u);
	x ^= (x >> 6u);
	x += (x << 3u);
	x ^= (x >> 11u);
	x += (x << 15u);
	return x;
}

uint hash(uvec2 v) {
	return hash(v.x ^ hash(v.y));
}

// Uniform in [0, 1), a function of v; different salts make independent ones.
float random(vec2 v, uint salt) {
	// Hash bits become the mantissa of a float in [1, 2); subtract 1.
	const uint mantissa_mask = 0x007FFFFFu;
	const uint one = 0x3F800000u;
	uint h = hash(floatBitsToUint(v) ^ salt);
	return uintBitsToFloat((h & mantissa_mask) | one) - 1.0;
}

// One step: the kernel over the previous frame, with some of that frame kept.
vec3 step_from_previous(vec2 uv) {
	// Static per-pixel jitter on the tap spacing (uv is the same every frame). It speckles stripe
	// edges, over a band that widens with the spacing.
	vec2 tap = tap_spacing * vec2(1.0 + jitter * (2.0 * random(uv, 0u) - 1.0));
	// Each tap reads the whole texel it lands in: pixel centers are at half-integers, so the
	// floor rounds the offset to the nearest whole pixel. Wrapping makes the screen a torus:
	// patterns wrap across edges.
	vec4 sum = vec4(0.0);
	for (int y = -2; y <= 2; y++) {
		for (int x = -2; x <= 2; x++) {
			vec2 texel = mod(floor(gl_FragCoord.xy + tap * vec2(x, y)), res);
			sum += texelFetch(prev_frame, ivec2(texel), 0) * kernel[(y + 2) * 5 + (x + 2)];
		}
	}
	// Same as blending the kernel toward identity: slows growth; persistence = 1 freezes the image.
	// Below 0, it blends away from identity: more of what the kernel does.
	return mix(sum.rgb, texelFetch(prev_frame, ivec2(gl_FragCoord.xy), 0).rgb, clamp(persistence, -1.0, 1.0));
}

// The distance from p to the segment from a to b.
float distance_to_segment(vec2 p, vec2 a, vec2 b) {
	vec2 ab = b - a;
	float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
	return length(p - a - t * ab);
}

void main() {
	vec2 uv = gl_FragCoord.xy / res;
	if (painting) {
		vec4 previous = texelFetch(prev_frame, ivec2(gl_FragCoord.xy), 0);
		bool inside = distance_to_segment(gl_FragCoord.xy, stroke.xy, stroke.zw) <= brush;
		gl_FragColor = inside ? vec4(paint, 0.0) : previous;
		return;
	}
	// The noise is the same at every restart of the same size. Pixel n's center is at n + 0.5.
	vec3 color = starting
		? ground + noise * (2.0 * vec3(random(uv, 1u), random(uv, 2u), random(uv, 3u)) - 1.0)
			+ wave.z * cos(6.283185307 * dot(wave.xy, floor(gl_FragCoord.xy)))
		: step_from_previous(uv);

	// The clamp is what stops amplified frequencies growing forever (the 8-bit buffers would
	// clamp anyway, and also round to 1/255). Then the seeds are stamped.
	vec3 clamped = clamp(color, 0.0, 1.0);
	float clipped = starting ? 0.0 : dot(vec3(notEqual(color, clamped)), vec3(1.0, 2.0, 4.0)) / 255.0;
	vec4 seed = texture(seeds, uv);
	gl_FragColor = vec4(mix(clamped, seed.rgb, starting || stamp ? seed.a : 0.0), clipped);
}
