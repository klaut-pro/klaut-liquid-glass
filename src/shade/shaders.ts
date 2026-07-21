/** Full-screen quad + liquid glass fragment (refraction, metaballs, thin-film). */

export const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_backdrop;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_glass;
uniform float u_liquify;
uniform float u_drip;
uniform float u_dispersion;
uniform float u_filmThickness;
uniform float u_ior;
uniform float u_bevel;
uniform float u_blur;
uniform float u_cornerRadius;
uniform float u_specular;
uniform float u_reducedMotion;

// --- SDF helpers (Inigo Quilez style) ---
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float softMin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-4), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float metaball(vec2 p, vec2 c, float r) {
  float d = length(p - c);
  return r * r / max(d * d, 1e-4);
}

float fieldAt(vec2 p, vec2 halfSize, float radius) {
  // Base pane SDF (negative inside)
  float pane = sdRoundBox(p, halfSize, radius);

  // Liquify: warp + soft metaball melt along surface
  float liquify = u_liquify;
  float drip = u_drip;
  float t = u_time * (1.0 - u_reducedMotion);

  if (liquify > 0.001 || drip > 0.001) {
    float field = 0.0;
    // Seed blobs along medial / bottom edge for drip emission
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float nx = (fi - 3.5) / 4.0;
      float seed = hash21(vec2(fi, 7.1));
      float wobble = sin(t * (1.2 + seed) + fi * 1.7) * 0.08 * liquify;
      vec2 c = vec2(
        nx * halfSize.x * 0.85 + wobble,
        -halfSize.y * (0.35 + 0.45 * liquify) + sin(t * 0.9 + fi) * 0.06 * liquify
      );
      float r = mix(0.08, 0.22, seed) * (0.35 + liquify) * min(halfSize.x, halfSize.y);
      field += metaball(p, c, r) * liquify;

      // Falling drops
      if (drip > 0.001) {
        float fall = fract(t * (0.15 + seed * 0.25) + seed);
        vec2 dropC = vec2(
          nx * halfSize.x * 0.7 + sin(t + fi) * 0.04,
          mix(halfSize.y * 0.2, -halfSize.y * 1.35, fall)
        );
        float dropR = mix(0.04, 0.1, seed) * drip * min(halfSize.x, halfSize.y);
        field += metaball(p, dropC, dropR) * drip * smoothstep(0.0, 0.15, fall) * smoothstep(1.0, 0.7, fall);
      }
    }

    // Convert density field to soft distance and blend with pane
    float metaDist = 0.35 / max(sqrt(field + 1e-4), 1e-3) - 0.55;
    float k = mix(0.02, 0.18, liquify);
    pane = softMin(pane, metaDist, k);
  }

  return pane;
}

vec2 gradField(vec2 p, vec2 halfSize, float radius) {
  float e = 1.5 / max(u_resolution.x, u_resolution.y);
  float dx = fieldAt(p + vec2(e, 0.0), halfSize, radius) - fieldAt(p - vec2(e, 0.0), halfSize, radius);
  float dy = fieldAt(p + vec2(0.0, e), halfSize, radius) - fieldAt(p - vec2(0.0, e), halfSize, radius);
  return normalize(vec2(dx, dy) + 1e-6);
}

// Cheap 9-tap blur of backdrop
vec3 sampleBlur(vec2 uv, float amount) {
  if (amount < 0.001) return texture(u_backdrop, uv).rgb;
  vec2 px = amount * 2.5 / u_resolution;
  vec3 c = texture(u_backdrop, uv).rgb * 0.2;
  c += texture(u_backdrop, uv + vec2(px.x, 0.0)).rgb * 0.1;
  c += texture(u_backdrop, uv - vec2(px.x, 0.0)).rgb * 0.1;
  c += texture(u_backdrop, uv + vec2(0.0, px.y)).rgb * 0.1;
  c += texture(u_backdrop, uv - vec2(0.0, px.y)).rgb * 0.1;
  c += texture(u_backdrop, uv + px).rgb * 0.1;
  c += texture(u_backdrop, uv - px).rgb * 0.1;
  c += texture(u_backdrop, uv + vec2(px.x, -px.y)).rgb * 0.1;
  c += texture(u_backdrop, uv + vec2(-px.x, px.y)).rgb * 0.1;
  return c;
}

// Thin-film interference tint (soap / oil fringe) — cyan–magenta–lime, not purple bloom
vec3 thinFilm(float thickness, float ndotv, float strength) {
  float phase = thickness * 48.0 * (1.0 - ndotv * 0.65) + u_time * 0.4 * (1.0 - u_reducedMotion);
  // Spectral-ish lobes via phase shifts (approximate interference)
  vec3 fringe = 0.5 + 0.5 * cos(vec3(phase, phase + 2.094, phase + 4.188));
  // Bias away from flat purple: boost cyan/lime channels relative to magenta mid
  fringe = mix(fringe, fringe * vec3(0.85, 1.15, 1.05), 0.55);
  return mix(vec3(1.0), fringe, strength);
}

void main() {
  vec2 res = u_resolution;
  vec2 uv = v_uv;
  // Pixel space centered
  vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
  float aspect = res.x / max(res.y, 1.0);
  vec2 halfSize = vec2(aspect * 0.48, 0.48);
  float radius = u_cornerRadius * min(halfSize.x, halfSize.y) * 2.0;

  float d = fieldAt(p, halfSize, radius);
  float aa = fwidth(d) * 1.5;
  float mask = 1.0 - smoothstep(-aa, aa, d);

  if (mask < 0.001) {
    outColor = vec4(0.0);
    return;
  }

  vec2 g = gradField(p, halfSize, radius);
  // Bevel: fake height from SDF for stronger normals near edge
  float edge = smoothstep(0.08, 0.0, abs(d));
  float z = u_bevel * edge * 0.85;
  vec3 N = normalize(vec3(g * (1.0 + z), 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndotv = max(dot(N, V), 0.0);

  // Snell-inspired UV offset
  float eta = 1.0 / max(u_ior, 1.01);
  vec3 Rdir = refract(-V, N, eta);
  float refrStr = (0.04 + 0.12 * u_glass) * (1.0 + u_liquify * 0.5);
  vec2 offsetBase = Rdir.xy * refrStr;

  // Chromatic dispersion: per-channel η (Cauchy-ish)
  float disp = u_dispersion;
  float etaR = eta * (1.0 - 0.04 * disp);
  float etaG = eta;
  float etaB = eta * (1.0 + 0.05 * disp);
  vec2 oR = refract(-V, N, etaR).xy * refrStr * (1.0 + 0.35 * disp);
  vec2 oG = offsetBase;
  vec2 oB = refract(-V, N, etaB).xy * refrStr * (1.0 + 0.45 * disp);

  vec2 baseUv = uv;
  float blurAmt = u_blur * (0.4 + 0.6 * u_glass);
  float r = sampleBlur(clamp(baseUv + oR, 0.0, 1.0), blurAmt).r;
  float gch = sampleBlur(clamp(baseUv + oG, 0.0, 1.0), blurAmt).g;
  float b = sampleBlur(clamp(baseUv + oB, 0.0, 1.0), blurAmt).b;
  vec3 refracted = vec3(r, gch, b);

  // Fresnel (Schlick)
  float F0 = pow((1.0 - u_ior) / (1.0 + u_ior), 2.0);
  float fres = F0 + (1.0 - F0) * pow(1.0 - ndotv, 5.0);
  vec3 reflectTint = vec3(0.92, 0.95, 1.0);
  vec3 color = mix(refracted, reflectTint, fres * 0.55 * u_glass);

  // Thin-film psychedelic fringe
  float film = u_filmThickness;
  if (film > 0.001) {
    float thick = film * (0.55 + 0.45 * edge + 0.25 * u_liquify * hash21(floor(p * 40.0)));
    vec3 filmTint = thinFilm(thick, ndotv, film * (0.35 + 0.4 * edge));
    color *= filmTint;
    // Extra fringe along edges / drops
    color += (filmTint - 0.5) * film * fres * 0.35;
  }

  // Specular lobe
  vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * u_specular;
  color += vec3(spec);

  // Soft glass veil
  color = mix(refracted, color, u_glass);
  float alpha = mask * mix(0.55, 0.92, u_glass);

  outColor = vec4(color, alpha);
}
`;
