// Model-output: Claude Opus 5.5
//
// Shows the latest frame on the canvas, whose pixels are the buffers' pixels, one way or another.
uniform sampler2D current;
uniform sampler2D previous;   // The frame before
uniform int view;             // An index into simulation.ts's VIEWS

void main() {
	ivec2 p = ivec2(gl_FragCoord.xy);
	vec4 now = texelFetch(current, p, 0);
	vec3 color;
	if (view == 0) {
		color = now.rgb;
	} else if (view <= 3) {
		color = vec3(now[view - 1]);
	} else if (view == 4) {
		// The square root shows small changes, such as a growing front's.
		color = sqrt(abs(now.rgb - texelFetch(previous, p, 0).rgb));
	} else {
		int clipped = int(round(now.a * 255.0));
		color = vec3((clipped & 1) != 0, (clipped & 2) != 0, (clipped & 4) != 0);
	}
	gl_FragColor = vec4(color, 1.0);
}
