// The bloom's bright pass, with a soft knee (0187).
//
// three's UnrealBloomPass gates on luminance: a pixel over the threshold goes into the bloom whole. On the
// Wall that let two things through that aren't lights. A red LED strip (5.5, 0.26, 0.36) has a luminance of
// only 1.4, so it cleared the 0.82 gate and bloomed at its full 5.5 red, and in a phone's narrow frame, close
// to the curl, that halo filled 36–63 % of the picture with saturated red (critique 2026-11-10 16:00). And the
// white paint under the two washes aimed at the hang is 2–4 in HDR, so the whole car bloomed: its tyres, glass
// and shut lines washed out to luma 140 (P10 of its box) on every screen.
//
// With `knee` on, the bright pass reads a pixel's brightest channel and sends only what is over the threshold
// into the bloom: a lamp at 6–9 keeps a glow, a strip at 5.5 keeps a thin one, and a lit surface under it
// sends nothing. `knee` off is three's pass, bit for bit, so a look that doesn't ask for it is unchanged.
// Measured with scripts/look-audit.mjs.
export const KNEE_FS = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec3 defaultColor;
  uniform float defaultOpacity;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  uniform float knee;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    if (knee > 0.5) {
      float m = max(texel.r, max(texel.g, texel.b));
      gl_FragColor = vec4(texel.rgb * (max(m - luminosityThreshold, 0.0) / max(m, 1e-4)), 1.0);
      return;
    }
    float v = luminance(texel.xyz);
    vec4 outputColor = vec4(defaultColor.rgb, defaultOpacity);
    float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
    gl_FragColor = mix(outputColor, texel, alpha);
  }`;

// Gives an UnrealBloomPass a `knee` property (0 or 1; default 0, three's own gate), set like its threshold
// through a look's `bloom` (scene.js Object.assign).
export function kneeBloom(pass) {
  const u = pass.highPassUniforms;
  u.knee = { value: 0 };
  const m = pass.materialHighPassFilter;
  m.fragmentShader = KNEE_FS;
  m.needsUpdate = true;
  Object.defineProperty(pass, 'knee', { get: () => u.knee.value, set: (v) => { u.knee.value = v ? 1 : 0; }, enumerable: true });
  return pass;
}

// What a look's bloom means for the pass: knee off unless the look asks for it, so switching from a look
// that has it (the Wall) to one that doesn't (the Lineup, a road) turns it off. `native` (the iPhone app's export,
// scripts/native-stage-page.js) is not the pass's.
export const bloomLook = ({ native, ...b } = {}) => ({ knee: 0, ...b });
