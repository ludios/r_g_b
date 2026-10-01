// One simulation step. Needs WebGL2 (uint, floatBitsToUint); three.js's WebGL2 prefix
// #defines gl_FragColor.
uniform vec2 res;             // Buffer size in pixels
uniform sampler2D prev_frame;
uniform sampler2D seeds;      // The seed-dot canvas
uniform float kernel[25];     // Row-major 5x5 weights, summing to 1
uniform float tap_spacing;    // In pixels
uniform float persistence;    // How much of the previous frame to keep

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

float random(vec2 v) {
	// Hash bits become the mantissa of a float in [1, 2); subtract 1.
	const uint mantissa_mask = 0x007FFFFFu;
	const uint one = 0x3F800000u;
	uint h = hash(floatBitsToUint(v));
	return uintBitsToFloat((h & mantissa_mask) | one) - 1.0;
}

void main() {
	vec2 uv = gl_FragCoord.xy / res;

	// Static per-pixel +/-5% jitter on the tap spacing (uv is the same every frame). It speckles
	// stripe edges, over a band that widens with the spacing.
	vec2 tap = (1.0 / res) * tap_spacing * (random(uv) * 0.1 + 0.95);
	// The buffers use RepeatWrapping, so the screen is a torus: patterns wrap across edges.
	vec4 sum = vec4(0.0);
	for (int y = -2; y <= 2; y++) {
		for (int x = -2; x <= 2; x++) {
			sum += texture(prev_frame, uv + tap * vec2(x, y)) * kernel[(y + 2) * 5 + (x + 2)];
		}
	}

	// Same as blending the kernel toward identity: slows growth; persistence = 1 freezes the image.
	vec3 color = mix(sum.rgb, texture(prev_frame, uv).rgb, clamp(persistence, 0.0, 1.0));
	// The clamp is what stops amplified frequencies growing forever (the 8-bit buffers would
	// clamp anyway, and also round to 1/255). Then re-stamp the seed dots.
	vec4 seed = texture(seeds, uv);
	gl_FragColor = vec4(mix(clamp(color, 0.0, 1.0), seed.rgb, seed.a), 1.0);
}
