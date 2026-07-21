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

/** Max CPU drip blobs uploaded per frame (must match DripSim.MAX_DRIP_BLOBS). */
export const SHADER_MAX_BLOBS = 24;

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
uniform float u_viscosity;
uniform float u_dispersion;
uniform float u_filmThickness;
uniform float u_ior;
uniform float u_bevel;
uniform float u_blur;
uniform float u_cornerRadius;
uniform float u_specular;
uniform float u_reducedMotion;
uniform vec3 u_lightPos;
uniform float u_lightIntensity;
uniform int u_blobCount;
uniform vec4 u_blobs[24]; // xy center, z radius, w weight
uniform float u_fieldMode; // 0 = pane, 1 = glyph
uniform float u_glyphId;   // 0 = chromeSansP, 1 = scriptProP

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

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

/** Block geometric lowercase p (1c6PD / Z53Ve). */
float glyphChromeSansP(vec2 p) {
  vec2 q = p * 1.06;
  float stem = sdRoundBox(q - vec2(-0.11, -0.04), vec2(0.085, 0.26), 0.075);
  float bowl = length(q - vec2(0.085, 0.04)) - 0.148;
  float hole = length(q - vec2(0.085, 0.04)) - 0.062;
  float body = softMin(stem, bowl, 0.038);
  body = max(body, -hole);
  return body;
}

/** Molten script p (ENj9B ".pro" — cursive loop + descender). */
float glyphScriptProP(vec2 p) {
  vec2 q = p * 1.0;
  float desc = sdCapsule(q, vec2(-0.02, -0.36), vec2(-0.10, -0.08), 0.042);
  float left = sdCapsule(q, vec2(-0.10, -0.08), vec2(-0.12, 0.12), 0.046);
  float top = sdCapsule(q, vec2(-0.12, 0.12), vec2(0.04, 0.22), 0.044);
  float right = sdCapsule(q, vec2(0.04, 0.22), vec2(0.14, 0.06), 0.042);
  float close = sdCapsule(q, vec2(0.14, 0.06), vec2(0.02, -0.12), 0.04);
  float g = softMin(desc, left, 0.03);
  g = softMin(g, top, 0.028);
  g = softMin(g, right, 0.026);
  g = softMin(g, close, 0.024);
  return g;
}

float glyphField(vec2 p) {
  if (u_glyphId < 0.5) return glyphChromeSansP(p);
  return glyphScriptProP(p);
}

float fieldAt(vec2 p, vec2 halfSize, float radius) {
  float pane = u_fieldMode > 0.5
    ? glyphField(p)
    : sdRoundBox(p, halfSize, radius);
  float liquify = u_liquify;
  float viscosity = u_viscosity;

  // Soft bottom sag (pane only — glyph QA isolates drip on letterform)
  if (liquify > 0.001 && u_fieldMode < 0.5) {
    float bottom = -halfSize.y;
    float nearBottom = smoothstep(halfSize.y * 0.35, -halfSize.y * 0.95, p.y);
    float sag = liquify * 0.06 * nearBottom * (1.0 - abs(p.x) / max(halfSize.x, 1e-3));
    pane -= sag * halfSize.y;
  }

  // CPU drip / liquify blobs (smoothMin merge; viscosity widens blend)
  if (u_blobCount > 0) {
    float field = 0.0;
    for (int i = 0; i < 24; i++) {
      if (i >= u_blobCount) break;
      vec4 b = u_blobs[i];
      if (b.w < 0.001 || b.z < 1e-5) continue;
      field += metaball(p, b.xy, b.z) * b.w;
    }
    if (field > 1e-5) {
      float metaDist = 0.32 / max(sqrt(field + 1e-4), 1e-3) - 0.52;
      float k = mix(0.03, 0.2, mix(liquify, viscosity, 0.55));
      pane = softMin(pane, metaDist, k);
    }
  }

  return pane;
}

vec2 gradField(vec2 p, vec2 halfSize, float radius) {
  // Fixed epsilon in field space — stable across DPR/resizes (avoids normal flicker)
  float e = 0.0025;
  float dx = fieldAt(p + vec2(e, 0.0), halfSize, radius) - fieldAt(p - vec2(e, 0.0), halfSize, radius);
  float dy = fieldAt(p + vec2(0.0, e), halfSize, radius) - fieldAt(p - vec2(0.0, e), halfSize, radius);
  return normalize(vec2(dx, dy) + 1e-6);
}

vec3 sampleBlur(vec2 uv, float amount) {
  vec2 uvc = clamp(uv, 0.0, 1.0);
  if (amount < 0.001) return texture(u_backdrop, uvc).rgb;
  vec2 px = amount * 2.5 / u_resolution;
  vec3 c = texture(u_backdrop, uvc).rgb * 0.2;
  c += texture(u_backdrop, clamp(uvc + vec2(px.x, 0.0), 0.0, 1.0)).rgb * 0.1;
  c += texture(u_backdrop, clamp(uvc - vec2(px.x, 0.0), 0.0, 1.0)).rgb * 0.1;
  c += texture(u_backdrop, clamp(uvc + vec2(0.0, px.y), 0.0, 1.0)).rgb * 0.1;
  c += texture(u_backdrop, clamp(uvc - vec2(0.0, px.y), 0.0, 1.0)).rgb * 0.1;
  c += texture(u_backdrop, clamp(uvc + px, 0.0, 1.0)).rgb * 0.1;
  c += texture(u_backdrop, clamp(uvc - px, 0.0, 1.0)).rgb * 0.1;
  c += texture(u_backdrop, clamp(uvc + vec2(px.x, -px.y), 0.0, 1.0)).rgb * 0.1;
  c += texture(u_backdrop, clamp(uvc + vec2(-px.x, px.y), 0.0, 1.0)).rgb * 0.1;
  return c;
}

/**
 * Thin-film interference driven by view + light angle (path Δ), not raw time noise.
 * Slow optional drift only when motion is allowed — keeps fringe temporally coherent.
 */
vec3 thinFilm(float thickness, float ndotv, float ndotl, float strength) {
  float phase = thickness * 42.0 * (1.0 - ndotv * 0.55) + ndotl * 6.0;
  phase += u_time * 0.08 * (1.0 - u_reducedMotion);
  vec3 fringe = 0.5 + 0.5 * cos(vec3(phase, phase + 2.094, phase + 4.188));
  // Bias away from flat purple bloom toward cyan–lime fire
  fringe = mix(fringe, fringe * vec3(0.82, 1.18, 1.08), 0.6);
  return mix(vec3(1.0), fringe, strength);
}

/**
 * Cauchy / Abbe dispersion (KHR_materials_dispersion style).
 * n(λ) = n_d + ((n_d-1)/V_d) * (λ_d^{-2} - λ^{-2}) / (λ_F^{-2}-λ_C^{-2}) approx:
 * halfSpread = (ior-1) * 0.025 * dispersionAmount  → η_R/G/B
 * Fringe strength modulated by light: stronger where Snell bend aligns with light.
 */
void spectralOffsets(
  vec3 N, vec3 V, vec3 L,
  float baseIor, float dispAmt, float refrStr,
  out vec2 oR, out vec2 oG, out vec2 oB,
  out float lightDisp
) {
  // Abbe: higher dispAmt → lower V_d → wider η spread
  float halfSpread = (baseIor - 1.0) * 0.028 * dispAmt;
  float nR = max(1.01, baseIor - halfSpread); // red longer λ → lower n
  float nG = max(1.01, baseIor);
  float nB = max(1.01, baseIor + halfSpread);

  float etaR = 1.0 / nR;
  float etaG = 1.0 / nG;
  float etaB = 1.0 / nB;

  vec3 rR = refract(-V, N, etaR);
  vec3 rG = refract(-V, N, etaG);
  vec3 rB = refract(-V, N, etaB);

  // Light-relative prismatic weight: dispersion visible where refraction
  // shears toward / against the light (edge fire), not a uniform RGB smear.
  float ndotl = max(dot(N, L), 0.0);
  float fresL = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float shear = length(rB.xy - rR.xy);
  lightDisp = clamp(
    (0.25 + 0.75 * u_lightIntensity) * (0.35 + 0.65 * fresL) * (0.4 + 0.6 * ndotl) * (0.5 + shear * 8.0),
    0.0,
    2.0
  );

  float scale = refrStr * (1.0 + 0.55 * dispAmt * lightDisp);
  oR = rR.xy * scale;
  oG = rG.xy * refrStr;
  oB = rB.xy * scale * (1.0 + 0.08 * dispAmt);
}

void main() {
  vec2 res = u_resolution;
  vec2 uv = v_uv;
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
  float edge = smoothstep(0.08, 0.0, abs(d));
  float z = u_bevel * edge * 0.85;
  vec3 N = normalize(vec3(g * (1.0 + z), 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndotv = max(dot(N, V), 0.0);

  // Material light (point → directional from surface toward light)
  vec3 lightWorld = u_lightPos;
  vec3 L = normalize(lightWorld - vec3(p, 0.0) * 0.35);
  float ndotl = max(dot(N, L), 0.0);

  float refrStr = (0.04 + 0.12 * u_glass) * (1.0 + u_liquify * 0.45);
  if (u_fieldMode > 0.5) refrStr *= 1.4;
  vec2 oR, oG, oB;
  float lightDisp;
  spectralOffsets(N, V, L, u_ior, u_dispersion, refrStr, oR, oG, oB, lightDisp);

  float blurAmt = u_blur * (0.4 + 0.6 * u_glass);
  if (u_fieldMode > 0.5) blurAmt *= 0.22; // sharper glyph chrome
  // Premultiply dispersion offsets by lightDisp so dark-side fringe stays quiet
  float dispMix = clamp(u_dispersion * lightDisp, 0.0, 1.5);
  oR *= mix(0.15, 1.0, clamp(dispMix, 0.0, 1.0));
  oB *= mix(0.15, 1.0, clamp(dispMix, 0.0, 1.0));

  float r = sampleBlur(uv + oR, blurAmt).r;
  float gch = sampleBlur(uv + oG, blurAmt).g;
  float b = sampleBlur(uv + oB, blurAmt).b;
  vec3 refracted = vec3(r, gch, b);

  // Fresnel (Schlick) — view
  float F0 = pow((1.0 - u_ior) / (1.0 + u_ior), 2.0);
  float fres = F0 + (1.0 - F0) * pow(1.0 - ndotv, 5.0);
  // Light-tinted reflection (cool on lit rim)
  vec3 reflectTint = mix(vec3(0.9, 0.92, 0.96), vec3(1.0, 1.0, 1.0), ndotl);
  float interior = smoothstep(0.0, 0.14, abs(d));
  float chromeMix = u_fieldMode > 0.5 ? 0.78 : 0.55;
  vec3 color = mix(refracted, reflectTint, fres * chromeMix * u_glass * mix(1.15, 0.18, interior));
  if (u_fieldMode > 0.5) {
    color += reflectTint * edge * 0.55 * u_lightIntensity * u_specular;
    color = mix(color * 0.78, color, edge); // darker chrome body, bright rims
    // Environment reflection (chrome reads backdrop softbox)
    vec2 envUv = clamp(uv + N.xy * refrStr * 2.4, 0.0, 1.0);
    vec3 env = sampleBlur(envUv, blurAmt * 0.4);
    color = mix(color, env, mix(0.22, 0.62, 1.0 - interior) * 0.9);
    // Concept-art vertical softbox stripe (1c6PD / Z53Ve)
    float bar = smoothstep(0.32, 0.0, abs(p.x + 0.16)) * smoothstep(-0.55, 0.42, p.y);
    color += vec3(1.0) * bar * 0.52 * u_lightIntensity * mix(0.35, 1.0, edge);
    if (u_glyphId > 0.5) {
      vec3 magenta = vec3(1.18, 0.52, 0.92);
      color = mix(color, color * magenta, 0.48 + 0.32 * edge);
    } else {
      vec3 chrome = vec3(0.92, 0.96, 1.08);
      color = mix(color, color * chrome, 0.18 + 0.22 * (1.0 - interior));
      vec3 bodySpec = 0.5 + 0.5 * cos(vec3(p.y * 9.0, p.y * 9.0 + 2.1, p.y * 9.0 + 4.2));
      color += bodySpec * (1.0 - interior) * 0.14 * u_dispersion;
    }
  }

  // Thin-film: spatial hash is static (floor only) — no per-frame sparkle
  float film = u_filmThickness;
  if (film > 0.001) {
    float thick = film * (0.55 + 0.45 * edge + 0.2 * u_liquify * hash21(floor(p * 28.0)));
    float filmStr = film * (0.3 + 0.45 * edge) * (0.5 + 0.5 * ndotl * u_lightIntensity);
    if (u_fieldMode > 0.5) filmStr *= mix(0.72, 1.0, edge);
    vec3 filmTint = thinFilm(thick, ndotv, ndotl, filmStr);
    color *= filmTint;
    color += (filmTint - 0.5) * film * fres * 0.28 * u_lightIntensity;
  }

  // Specular from material light — tight hot spot (concept-art star glints)
  vec3 H = normalize(L + V);
  float specTight = pow(max(dot(N, H), 0.0), mix(72.0, 128.0, step(0.5, u_fieldMode)));
  float specWide = pow(max(dot(N, H), 0.0), mix(24.0, 36.0, step(0.5, u_fieldMode)));
  float spec = (specTight * 1.35 + specWide * 0.28) * u_specular * u_lightIntensity;
  color += vec3(spec);
  if (u_fieldMode > 0.5 && specTight > 0.35) {
    color += vec3(1.0) * specTight * 0.55 * u_lightIntensity;
  }

  // Spectral fire on lit rim: cyan↔magenta (concept art), not purple bloom wash
  if (u_dispersion > 0.01 && (spec > 0.01 || fres > 0.06 || u_fieldMode > 0.5)) {
    float fireAmt = u_dispersion * lightDisp * (0.35 + 0.65 * fres) * u_lightIntensity;
    if (u_fieldMode > 0.5) fireAmt *= mix(0.85, 1.35, edge);
    vec3 fire = mix(vec3(0.35, 1.15, 1.25), vec3(1.2, 0.45, 0.95), 0.5 + 0.5 * sin(ndotl * 6.0));
    color += fire * fireAmt * (0.2 + spec * 0.9);
    if (u_fieldMode > 0.5 && p.y < -0.08) {
      float dripLift = smoothstep(-0.06, -0.42, p.y) * edge;
      color += refracted * dripLift * 0.45;
      color += fire * dripLift * 0.22;
    }
    if (u_fieldMode > 0.5) {
      color += fire * (1.0 - edge) * 0.24; // interior iridescence
    }
  }

  if (u_fieldMode < 0.5) {
    color = mix(refracted, color, u_glass);
  }
  float alpha = mask * mix(0.55, 0.92, u_glass);
  if (u_fieldMode > 0.5) alpha = mask * mix(0.62, 0.96, u_glass);

  // Premultiplied alpha output
  outColor = vec4(color * alpha, alpha);
}
`;
