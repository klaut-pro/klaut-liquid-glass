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
uniform sampler2D u_glyphSdf;
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
uniform float u_useGlyphAtlas; // 1 = sample font-baked SDF texture
uniform float u_glyphSdfScale; // field-space |d| at encode extremes
uniform float u_glyphExtent;   // atlas covers [-extent, +extent]

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

/**
 * Font-baked EDT SDF (scripts/bake-glyph-sdf.py).
 * Encode: R = 0.5 - 0.5*(signedPx/maxDistPx); decode to Quilez signed field.
 */
float glyphAtlasField(vec2 p) {
  float ext = max(u_glyphExtent, 1e-4);
  vec2 uv = vec2(p.x / (2.0 * ext) + 0.5, p.y / (2.0 * ext) + 0.5);
  vec2 uvClamped = clamp(uv, 0.0, 1.0);
  float t = texture(u_glyphSdf, uvClamped).r;
  float d = (0.5 - t) * (2.0 * u_glyphSdfScale);
  // Outside atlas bounds: push positive distance
  vec2 over = max(abs(uv - 0.5) - 0.5, 0.0);
  d += length(over) * (2.0 * ext);
  return d;
}

/** Procedural fallbacks (only if atlas not ready). */
float glyphChromeSansP(vec2 p) {
  vec2 q = p * 1.06;
  float stem = sdRoundBox(q - vec2(-0.11, -0.04), vec2(0.085, 0.26), 0.045);
  float bowl = length(q - vec2(0.085, 0.04)) - 0.148;
  float hole = length(q - vec2(0.085, 0.04)) - 0.072;
  float body = softMin(stem, bowl, 0.018);
  body = max(body, -hole);
  return body;
}

float glyphScriptProP(vec2 p) {
  vec2 q = p * 1.0;
  float desc = sdCapsule(q, vec2(-0.02, -0.36), vec2(-0.10, -0.08), 0.042);
  float left = sdCapsule(q, vec2(-0.10, -0.08), vec2(-0.12, 0.12), 0.046);
  float top = sdCapsule(q, vec2(-0.12, 0.12), vec2(0.04, 0.22), 0.044);
  float right = sdCapsule(q, vec2(0.04, 0.22), vec2(0.14, 0.06), 0.042);
  float close = sdCapsule(q, vec2(0.14, 0.06), vec2(0.02, -0.12), 0.04);
  float g = softMin(desc, left, 0.022);
  g = softMin(g, top, 0.02);
  g = softMin(g, right, 0.018);
  g = softMin(g, close, 0.016);
  return g;
}

float glyphField(vec2 p) {
  if (u_useGlyphAtlas > 0.5) return glyphAtlasField(p);
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
      // Glyph QA: hard-ish union so font silhouettes stay crisp
      float k = u_fieldMode > 0.5
        ? mix(0.008, 0.028, viscosity)
        : mix(0.03, 0.2, mix(liquify, viscosity, 0.55));
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
 * High-contrast procedural studio for chrome glyphs.
 * Narrow softbox streaks on a dark void — concept chrome, not milky wash.
 */
vec3 studioEnv(vec3 R) {
  vec3 rn = normalize(R + 1e-5);
  vec2 e = rn.xy / (abs(rn.z) + 0.42);
  // Narrow vertical softboxes only
  float softV = smoothstep(0.055, 0.008, abs(e.x + 0.32));
  softV *= smoothstep(-1.1, -0.15, e.y) * smoothstep(1.05, 0.2, e.y);
  float softV2 = smoothstep(0.04, 0.006, abs(e.x - 0.48)) * 0.55;
  softV2 *= smoothstep(-0.9, 0.0, e.y);
  float softH = smoothstep(0.045, 0.01, abs(e.y - 0.38)) * 0.35;
  float key = pow(max(dot(rn, normalize(vec3(-0.55, 0.78, 0.42))), 0.0), 90.0);
  float fillM = pow(max(dot(rn, normalize(vec3(0.72, -0.2, 0.4))), 0.0), 48.0);
  float fillC = pow(max(dot(rn, normalize(vec3(0.1, 0.4, 0.85))), 0.0), 28.0);

  vec3 col = vec3(0.008, 0.01, 0.014);
  col += vec3(1.2, 1.12, 1.05) * softV * 1.9;
  col += vec3(0.7, 0.9, 1.15) * softV2 * 1.15;
  col += vec3(1.0, 0.95, 0.92) * softH * 0.85;
  col += vec3(0.9, 0.98, 1.15) * key * 2.6;
  col += vec3(1.4, 0.22, 0.95) * fillM * 0.9;
  col += vec3(0.2, 1.1, 1.2) * fillC * 0.45;
  float star = pow(max(dot(rn, normalize(vec3(-0.4, 0.82, 0.4))), 0.0), 320.0);
  col += vec3(1.5) * star * 4.0;
  return col;
}

/** Spectral edge fire: cyan ↔ magenta (concept art), grazing-weighted. */
vec3 edgeFire(float t, float amt) {
  vec3 cyan = vec3(0.2, 1.25, 1.4);
  vec3 mag = vec3(1.4, 0.25, 1.05);
  vec3 lime = vec3(0.6, 1.3, 0.4);
  vec3 fire = mix(cyan, mag, smoothstep(0.12, 0.88, t));
  fire = mix(fire, lime, 0.15 * sin(t * 6.28318));
  return fire * amt;
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

/** Nearest drip blob → spherical normal bias (pendant gloss). */
vec3 dripNormalBias(vec2 p) {
  float best = 1e9;
  vec2 bestC = vec2(0.0);
  float bestR = 0.05;
  for (int i = 0; i < 24; i++) {
    if (i >= u_blobCount) break;
    vec4 b = u_blobs[i];
    if (b.w < 0.001 || b.z < 1e-5) continue;
    float d = length(p - b.xy) / max(b.z, 1e-4);
    if (d < best) {
      best = d;
      bestC = b.xy;
      bestR = b.z;
    }
  }
  if (best > 2.2) return vec3(0.0);
  vec2 rel = (p - bestC) / max(bestR, 1e-4);
  float w = smoothstep(2.0, 0.35, best) * (0.55 + 0.45 * u_drip);
  // Hemisphere toward camera for wet bead
  return vec3(rel * 0.95, mix(0.35, 0.95, w)) * w;
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
  float inside = max(-d, 0.0);
  // Glyph: thin chrome lip — thick bevel floods thin strokes into milky rim
  float bevelW = u_fieldMode > 0.5 ? mix(0.012, 0.026, u_bevel) : mix(0.055, 0.11, u_bevel);
  float rim = 1.0 - smoothstep(0.0, bevelW, inside);
  float rimSharp = pow(rim, 1.85);
  float z = u_bevel * edge * 0.85;
  vec3 N;
  if (u_fieldMode > 0.5) {
    // Mild pillow — enough for softbox streaks, not a milky dome wash
    float pillow = 0.08 * (1.0 - rim) * u_bevel;
    vec2 faceWarp = p * pillow * vec2(0.9, 0.7);
    float gAmt = mix(0.05, 1.45, rimSharp) * (0.8 + 0.5 * u_bevel);
    vec3 dripN = dripNormalBias(p);
    N = normalize(vec3(
      g * gAmt + faceWarp + dripN.xy * 1.1,
      mix(0.72, 1.05, 1.0 - rimSharp * 0.65) + dripN.z * 0.45
    ));
    if (u_glyphId > 0.5) {
      // Tubular script: stronger cylinder normals
      N = normalize(mix(N, normalize(vec3(g * mix(0.35, 1.6, rimSharp), 0.62)), 0.4));
    }
  } else {
    N = normalize(vec3(g * (1.0 + z), 1.0));
  }
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndotv = max(dot(N, V), 0.0);

  // Material light (point → directional from surface toward light)
  vec3 lightWorld = u_lightPos;
  vec3 L = normalize(lightWorld - vec3(p, 0.0) * 0.35);
  float ndotl = max(dot(N, L), 0.0);
  vec3 R = reflect(-V, N);
  vec3 H = normalize(L + V);

  float refrStr = (0.04 + 0.12 * u_glass) * (1.0 + u_liquify * 0.45);
  if (u_fieldMode > 0.5) refrStr *= 0.28;
  vec2 oR, oG, oB;
  float lightDisp;
  spectralOffsets(N, V, L, u_ior, u_dispersion, refrStr, oR, oG, oB, lightDisp);

  float blurAmt = u_blur * (0.4 + 0.6 * u_glass);
  if (u_fieldMode > 0.5) blurAmt *= 0.05;
  float dispMix = clamp(u_dispersion * lightDisp, 0.0, 1.5);
  oR *= mix(0.15, 1.0, clamp(dispMix, 0.0, 1.0));
  oB *= mix(0.15, 1.0, clamp(dispMix, 0.0, 1.0));

  float r = sampleBlur(uv + oR, blurAmt).r;
  float gch = sampleBlur(uv + oG, blurAmt).g;
  float b = sampleBlur(uv + oB, blurAmt).b;
  vec3 refracted = vec3(r, gch, b);

  // Fresnel: dielectric for panes; chrome uses grazing-weighted Schlick (not high F0 wash)
  float F0d = pow((1.0 - u_ior) / (1.0 + u_ior), 2.0);
  float fres = F0d + (1.0 - F0d) * pow(1.0 - ndotv, 5.0);
  if (u_fieldMode > 0.5) {
    // Metal-ish: low base + strong grazing (dark face, bright rim)
    float F0m = 0.18;
    fres = F0m + (1.0 - F0m) * pow(1.0 - ndotv, 3.2);
    fres = clamp(fres * (0.35 + 0.9 * rimSharp) + rimSharp * 0.55, 0.0, 1.0);
  }

  vec3 color;
  if (u_fieldMode > 0.5) {
    // --- Dark polished chrome + selective gloss (concept 1c6PD / Z53Ve / ENj9B) ---
    vec3 env = studioEnv(R);
    // Plate softboxes: boost only where plate is bright (streaks), ignore dim void
    vec2 plateUv = clamp(0.5 + 0.5 * R.xy / (abs(R.z) + 0.45), 0.0, 1.0);
    vec3 plate = sampleBlur(plateUv, 0.0);
    float plateLuma = max(plate.r, max(plate.g, plate.b));
    env += plate * smoothstep(0.12, 0.55, plateLuma) * 1.1;

    vec3 darkBody = u_glyphId > 0.5
      ? vec3(0.028, 0.008, 0.026)
      : vec3(0.01, 0.012, 0.02);

    // Face stays dark; env only via Fresnel/rim + thin anisotropic streaks
    color = darkBody;
    color = mix(color, env, fres * u_glass * 0.55);

    // Softbox streaks across face (wet chrome signature) — gated, not full wash
    vec2 e = R.xy / (abs(R.z) + 0.45);
    float streak = smoothstep(0.045, 0.005, abs(e.x + 0.3));
    streak += 0.45 * smoothstep(0.035, 0.004, abs(e.x - 0.5));
    streak *= mix(0.25, 1.0, 0.2 + 0.8 * rimSharp);
    float screenBar = smoothstep(0.08, 0.015, abs(p.x + 0.14)) * smoothstep(-0.5, 0.35, p.y);
    streak = max(streak, screenBar * mix(0.2, 0.85, rimSharp));
    // Streaks are bright but narrow — don't wash the face
    color += vec3(1.3, 1.18, 1.08) * streak * (0.18 + 0.7 * rimSharp) * u_glass;

    vec2 T = normalize(vec2(-g.y, g.x) + 1e-5);
    float aniso = pow(max(1.0 - abs(dot(normalize(R.xy + 1e-5), T)), 0.0), 5.0);
    color += env * aniso * (0.06 + 0.28 * rimSharp);

    // Bright Fresnel rim — silver + env
    vec3 rimCol = mix(vec3(1.05, 1.1, 1.2), env * 2.0, 0.75);
    color = mix(color, max(color, rimCol), rimSharp * (0.78 + 0.22 * fres));

    if (u_glyphId > 0.5) {
      // Magenta wet metal on rim only — keep face dark polished
      color = mix(color, color * vec3(1.6, 0.32, 1.3), rimSharp * 0.78);
    } else {
      color = mix(color, color * vec3(0.6, 0.88, 1.3), rimSharp * 0.55);
    }

    // Crush face luma — keep near-black body but allow thin softbox streaks through
    float faceGate = 1.0 - rimSharp;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, color * (0.14 / max(luma, 0.06)), faceGate * 0.55);
    color = mix(color, darkBody, faceGate * 0.45);
    // Re-add a crisp softbox bar after crush (concept vertical reflection)
    float bar2 = smoothstep(0.055, 0.008, abs(p.x + 0.12)) * smoothstep(-0.45, 0.4, p.y);
    color += vec3(1.35, 1.2, 1.1) * bar2 * (0.15 + 0.55 * rimSharp) * faceGate;
    color += vec3(1.35, 1.2, 1.1) * bar2 * 0.85 * rimSharp;

    // Multi-lobe specular — hot stars (after face crush so glints survive)
    float specSoft = pow(max(dot(N, H), 0.0), 40.0);
    float specMid = pow(max(dot(N, H), 0.0), 128.0);
    float specStar = pow(max(dot(N, H), 0.0), 560.0);
    vec3 L2 = normalize(vec3(0.6, 0.3, 0.85) - vec3(p, 0.0) * 0.2);
    vec3 H2 = normalize(L2 + V);
    float spec2 = pow(max(dot(N, H2), 0.0), 240.0);
    float li = u_lightIntensity * u_specular;
    color += vec3(1.05, 1.0, 0.95) * specSoft * 0.32 * li * mix(0.4, 1.0, rimSharp);
    color += vec3(1.25) * specMid * 0.95 * li;
    color += vec3(1.6) * specStar * 3.4 * li;
    color += vec3(1.1, 0.92, 1.2) * spec2 * 0.7 * li;
    // Extra star from env key direction
    float envStar = pow(max(dot(N, normalize(vec3(-0.45, 0.8, 0.5))), 0.0), 380.0);
    color += vec3(1.5) * envStar * 2.2 * li * mix(0.5, 1.0, rimSharp);

    // Iridescent edge fire — rim-weighted cyan↔magenta
    float fireAmt = u_dispersion * (0.65 + 0.9 * fres) * mix(0.2, 1.45, rimSharp);
    fireAmt *= clamp(u_lightIntensity * 0.45, 0.55, 2.0);
    float fireT = fract(ndotl * 2.1 + fres * 0.85 + length(p) * 1.4 + rimSharp * 0.5);
    color += edgeFire(fireT, fireAmt * 0.95);
    color += edgeFire(1.0 - fireT, fireAmt * 0.45 * max(lightDisp, 0.35));

    float film = u_filmThickness;
    if (film > 0.001) {
      float thick = film * (0.55 + 0.45 * rimSharp);
      float filmStr = film * mix(0.05, 0.7, rimSharp) * (0.45 + 0.55 * ndotl);
      vec3 filmTint = thinFilm(thick, ndotv, ndotl, filmStr);
      color += (filmTint - 0.5) * filmStr * 1.05;
    }

    // Glossy pendant drips — liquid metal bead
    if (p.y < -0.05) {
      float dripZone = smoothstep(-0.04, -0.42, p.y);
      vec3 dripEnv = studioEnv(normalize(R + vec3(0.0, -0.4, 0.08)));
      color = mix(color, max(color, dripEnv * 1.25), dripZone * (0.45 + 0.45 * rimSharp));
      color += vec3(1.55) * specStar * dripZone * 2.6 * li;
      color += edgeFire(0.35 + 0.4 * ndotl, dripZone * u_dispersion * 0.85);
      // Dark glass between glints (not milky)
      color = mix(color, darkBody * 1.15, dripZone * (1.0 - rimSharp) * 0.45);
      color += vec3(1.3, 1.15, 1.4) * envStar * dripZone * 1.4 * li;
    }

    // Tiny glass refraction peek at rim only
    color = mix(color, color + refracted * 0.15, rimSharp * 0.12 * u_glass);
  } else {
    // Pane path
    vec3 reflectTint = mix(vec3(0.9, 0.92, 0.96), vec3(1.0, 1.0, 1.0), ndotl);
    float interior = smoothstep(0.0, 0.14, abs(d));
    color = mix(refracted, reflectTint, fres * 0.55 * u_glass * mix(1.25, 0.08, interior));

    float film = u_filmThickness;
    if (film > 0.001) {
      float thick = film * (0.55 + 0.45 * edge + 0.2 * u_liquify * hash21(floor(p * 28.0)));
      float filmStr = film * (0.3 + 0.45 * edge) * (0.5 + 0.5 * ndotl * u_lightIntensity);
      vec3 filmTint = thinFilm(thick, ndotv, ndotl, filmStr);
      color *= filmTint;
      color += (filmTint - 0.5) * film * fres * 0.28 * u_lightIntensity;
    }

    float specTight = pow(max(dot(N, H), 0.0), 72.0);
    float specWide = pow(max(dot(N, H), 0.0), 24.0);
    float spec = (specTight * 1.45 + specWide * 0.22) * u_specular * u_lightIntensity;
    color += vec3(spec);

    if (u_dispersion > 0.01 && (spec > 0.01 || fres > 0.06)) {
      float fireAmt = u_dispersion * lightDisp * (0.35 + 0.65 * fres) * u_lightIntensity;
      color += edgeFire(0.5 + 0.5 * sin(ndotl * 6.0), fireAmt * (0.12 + spec * 0.95) * mix(0.25, 1.0, edge));
      color += edgeFire(0.2, (1.0 - edge) * 0.12 * u_dispersion);
    }
    color = mix(refracted, color, u_glass);
  }

  float alpha = mask * mix(0.55, 0.92, u_glass);
  if (u_fieldMode > 0.5) alpha = mask * mix(0.82, 0.99, u_glass);

  // Premultiplied alpha output
  outColor = vec4(color * alpha, alpha);
}
`;
