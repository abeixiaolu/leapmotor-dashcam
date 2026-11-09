export const CLARITY_FRAGMENT_SHADER = `
precision highp float;
varying vec2 uv;
uniform sampler2D frame;
uniform vec2 quadrant;
uniform vec2 pixel;
uniform float fov;
uniform float strength;
uniform float clarityMode;
uniform float clarityAmount;

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

float neighborLuma(vec2 local) {
  return luma(texture2D(frame, (clamp(local, pixel, 1. - pixel) + quadrant) * .5).rgb);
}

void main() {
  vec2 p = (uv * 2. - 1.) * tan(radians(fov) * .5);
  p.y /= 1.25;
  float r = length(p);
  float k = r > .000001 ? atan(r) / r / 3.14159265 : 1. / 3.14159265;
  vec2 lens = .5 + p * k * vec2(1., 1.25);
  vec2 local = mix(uv, lens, strength);
  local = clamp(local, pixel, 1. - pixel);
  vec2 source = (local + quadrant) * .5;
  vec4 original = texture2D(frame, source);
  if (clarityMode < .5 || clarityAmount <= 0. || (clarityMode > 1.5 && uv.x < .5)) {
    gl_FragColor = original;
    return;
  }

  vec2 texelStep = pixel * 2.;
  float center = luma(original.rgb);
  float north = neighborLuma(local - vec2(0., texelStep.y));
  float south = neighborLuma(local + vec2(0., texelStep.y));
  float west = neighborLuma(local - vec2(texelStep.x, 0.));
  float east = neighborLuma(local + vec2(texelStep.x, 0.));
  float low = min(center, min(min(north, south), min(west, east)));
  float high = max(center, max(max(north, south), max(west, east)));
  float detail = center - (north + south + west + east) * .25;
  float contrast = high - low;
  float gate = smoothstep(.01, .05, contrast) * (1. - .5 * smoothstep(.15, .5, contrast));
  float limit = .025 * clarityAmount;
  float delta = clamp(detail * .6 * clarityAmount * gate, -limit, limit);
  delta = clamp(center + delta, low, high) - center;
  gl_FragColor = vec4(clamp(original.rgb + delta, 0., 1.), original.a);
}
`;
