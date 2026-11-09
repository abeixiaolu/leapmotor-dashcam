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

  vec2 stepSize = pixel * 2.;
  float center = luma(original.rgb);
  float n = neighborLuma(local + stepSize * vec2(0., -1.));
  float s = neighborLuma(local + stepSize * vec2(0., 1.));
  float w = neighborLuma(local + stepSize * vec2(-1., 0.));
  float e = neighborLuma(local + stepSize * vec2(1., 0.));
  float nw = neighborLuma(local + stepSize * vec2(-1., -1.));
  float ne = neighborLuma(local + stepSize * vec2(1., -1.));
  float sw = neighborLuma(local + stepSize * vec2(-1., 1.));
  float se = neighborLuma(local + stepSize * vec2(1., 1.));
  float low = min(center, min(min(n, s), min(w, e)));
  float high = max(center, max(max(n, s), max(w, e)));
  float range = high - low;
  float nearMean = (center * 4. + (n + s + w + e) * 2. + nw + ne + sw + se) / 16.;
  float fine = center - nearMean;
  fine = sign(fine) * max(abs(fine) - .003, 0.);
  float edgeGate = smoothstep(.012, .06, range) * (1. - .65 * smoothstep(.15, .5, range));
  float detail = fine * 2.2 * edgeGate;

  float farMean = (neighborLuma(local + stepSize * vec2(0., -6.))
    + neighborLuma(local + stepSize * vec2(0., 6.))
    + neighborLuma(local + stepSize * vec2(-6., 0.))
    + neighborLuma(local + stepSize * vec2(6., 0.))) * .25;
  float coarse = nearMean - farMean;
  coarse = sign(coarse) * max(abs(coarse) - .006, 0.);
  detail += clamp(coarse * 1.15, -.06, .06);

  float overshoot = range * .2 * clarityAmount;
  float corrected = clamp(
    center + clamp(detail * clarityAmount, -.07 * clarityAmount, .07 * clarityAmount),
    low - overshoot, high + overshoot
  );
  corrected += clarityAmount * .65 * corrected * (1. - corrected) * (2. * corrected - 1.);
  float delta = corrected - center;
  gl_FragColor = vec4(clamp(original.rgb + delta, 0., 1.), original.a);
}
`;
