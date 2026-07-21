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
export const SHADER_MAX_BLOBS = 48;

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
uniform vec4 u_blobs[48]; // xy center, z radius, w weight
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
 * Font-baked EDT SDF + height bevel (scripts/bake-glyph-sdf.py).
 * Encode: R = 0.5 - 0.5*(signedPx/maxDistPx); G = height bevel 0..1.
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

/** Height bevel from atlas G (planar plateau / tubular crest). */
float glyphAtlasHeight(vec2 p) {
  float ext = max(u_glyphExtent, 1e-4);
  vec2 uv = clamp(vec2(p.x / (2.0 * ext) + 0.5, p.y / (2.0 * ext) + 0.5), 0.0, 1.0);
  return texture(u_glyphSdf, uv).g;
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
  float d = u_useGlyphAtlas > 0.5
    ? glyphAtlasField(p)
    : (u_glyphId < 0.5 ? glyphChromeSansP(p) : glyphScriptProP(p));
  if (u_glyphId > 0.5) {
    // Script: softMin pipe join — continuous tubular elegance (ENj9B), no lag notch
    float jExt = length(p - vec2(-0.13, 0.17)) - 0.092;
    float jTop = length(p - vec2(-0.048, 0.11)) - 0.088;
    float jTop2 = length(p - vec2(-0.03, 0.08)) - 0.078;
    float jLow = length(p - vec2(-0.012, -0.02)) - 0.072;
    float jMid = length(p - vec2(-0.065, 0.04)) - 0.068;
    float jCap = sdCapsule(p, vec2(-0.125, 0.21), vec2(-0.01, -0.035), 0.078);
    float jCap2 = sdCapsule(p, vec2(-0.09, 0.16), vec2(-0.03, 0.04), 0.072);
    float jCap3 = sdCapsule(p, vec2(-0.11, 0.14), vec2(-0.04, 0.02), 0.066);
    float jCap4 = sdCapsule(p, vec2(-0.1, 0.18), vec2(-0.02, -0.01), 0.064);
    float jCap5 = sdCapsule(p, vec2(-0.08, 0.2), vec2(-0.015, 0.02), 0.06);
    d = softMin(d, jExt, 0.068);
    d = softMin(d, jTop, 0.064);
    d = softMin(d, jTop2, 0.06);
    d = softMin(d, jLow, 0.058);
    d = softMin(d, jMid, 0.056);
    d = softMin(d, jCap, 0.064);
    d = softMin(d, jCap2, 0.062);
    d = softMin(d, jCap3, 0.058);
    d = softMin(d, jCap4, 0.06);
    d = softMin(d, jCap5, 0.055);
  } else {
    // Chrome: architectural bowl–stem join notch (1c6PD/Z53Ve faceted block letters)
    float notch = sdRoundBox(p - vec2(0.015, 0.11), vec2(0.024, 0.032), 0.0035);
    float notch2 = sdRoundBox(p - vec2(-0.01, 0.145), vec2(0.016, 0.02), 0.0025);
    d = max(d, -notch);
    d = max(d, -notch2);
  }
  return d;
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
    for (int i = 0; i < 48; i++) {
      if (i >= u_blobCount) break;
      vec4 b = u_blobs[i];
      if (b.w < 0.001 || b.z < 1e-5) continue;
      field += metaball(p, b.xy, b.z) * b.w;
    }
    if (field > 1e-5) {
      float metaDist = 0.32 / max(sqrt(field + 1e-4), 1e-3) - 0.52;
      // Glyph: wider softMin — continuous stem↔filament (anti junction void)
      float k = u_fieldMode > 0.5
        ? mix(0.022, 0.048, viscosity)
        : mix(0.03, 0.2, mix(liquify, viscosity, 0.55));
      pane = softMin(pane, metaDist, k);

      // Explicit pendant capsule from lip→tip (viscous neck, not detached metaballs)
      if (u_fieldMode > 0.5 && u_blobCount >= 2) {
        vec2 topC = vec2(0.0);
        vec2 botC = vec2(0.0);
        float topR = 0.0;
        float botR = 0.0;
        float topY = -1e9;
        float botY = 1e9;
        for (int i = 0; i < 48; i++) {
          if (i >= u_blobCount) break;
          vec4 b = u_blobs[i];
          if (b.w < 0.15 || b.z < 1e-5) continue;
          if (b.y > topY) { topY = b.y; topC = b.xy; topR = b.z; }
          if (b.y < botY) { botY = b.y; botC = b.xy; botR = b.z; }
        }
        if (topY - botY > 0.03) {
          vec2 lipC = topC + vec2(0.0, max(0.035, topR * 0.55));
          // Continuous tubular mid-filament (anti-void stem–bulb junction)
          float midR = mix(topR, botR, 0.45) * mix(0.34, 0.22, viscosity);
          float cap = sdCapsule(p, lipC, botC, max(midR, 0.018));
          pane = softMin(pane, cap, mix(0.022, 0.038, viscosity));
          // Extra mid-neck capsules for freeze tubular elegance
          vec2 midC = mix(lipC, botC, 0.4);
          float midCap = sdCapsule(p, mix(lipC, midC, 0.3), mix(midC, botC, 0.55), max(midR * 1.2, 0.02));
          pane = softMin(pane, midCap, mix(0.018, 0.032, viscosity));
          float midCap2 = sdCapsule(p, mix(lipC, midC, 0.55), mix(midC, botC, 0.75), max(midR * 1.05, 0.018));
          pane = softMin(pane, midCap2, mix(0.016, 0.028, viscosity));
        }
      }
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
  // Oil-slick: lime↔gold only (no cyan/magenta RGB phase flood)
  float w = 0.5 + 0.5 * cos(phase);
  vec3 lime = vec3(0.55, 1.35, 0.32);
  vec3 gold = vec3(1.32, 1.08, 0.28);
  vec3 fringe = mix(lime, gold, w);
  fringe = mix(vec3(1.0), fringe, 0.72);
  return mix(vec3(1.0), fringe, strength);
}

/**
 * Planar studio-plate UV from reflection (plate is frontal softbox layout, not equirect).
 * Equirect would scramble knife-edge bars into soft mush.
 */
vec2 studioPlateUv(vec3 R) {
  vec3 rn = normalize(R + 1e-5);
  return clamp(0.5 + 0.5 * rn.xy / (abs(rn.z) + 0.22), 0.0, 1.0);
}

/**
 * Procedural studio accents + frontal HDRI plate sample.
 * Soft elliptical lobes (planar wet-mirror) — NOT vertical barcode razor bars.
 */
vec3 studioEnv(vec3 R) {
  vec3 rn = normalize(R + 1e-5);
  vec2 e = rn.xy / (abs(rn.z) + 0.28);
  // Soft elliptical softbox lobes (wide, blurry) — anti barcode columns
  float softA = exp(-dot((e - vec2(-0.22, 0.28)) * vec2(1.15, 1.65), (e - vec2(-0.22, 0.28)) * vec2(1.15, 1.65)) * 2.6);
  float softB = exp(-dot((e - vec2(0.32, 0.18)) * vec2(1.05, 1.55), (e - vec2(0.32, 0.18)) * vec2(1.05, 1.55)) * 2.9);
  float softC = exp(-dot((e - vec2(0.05, -0.15)) * vec2(0.95, 1.25), (e - vec2(0.05, -0.15)) * vec2(0.95, 1.25)) * 2.1) * 0.55;
  float softH = exp(-pow((e.y - 0.35) * 3.2, 2.0)) * 0.45;
  float key = pow(max(dot(rn, normalize(vec3(-0.55, 0.78, 0.42))), 0.0), 120.0);
  float fillM = pow(max(dot(rn, normalize(vec3(0.72, -0.15, 0.35))), 0.0), 36.0);
  float fillC = pow(max(dot(rn, normalize(vec3(0.05, 0.35, 0.9))), 0.0), 28.0);

  // Dark ambient floor — wet chrome, not lavender fog
  vec3 col = vec3(0.028, 0.03, 0.042);
  col += vec3(0.14, 0.18, 0.28) * (0.25 + 0.35 * max(rn.y, 0.0));
  // Soft softbox peaks (white-biased; lime/gold as thin accents only)
  col += vec3(2.05, 2.0, 1.95) * softA * 4.2;
  col += vec3(1.85, 1.9, 1.95) * softB * 3.6;
  col += vec3(1.55, 1.7, 0.55) * softC * 1.1; // gold puddle, not magenta
  col += vec3(1.5, 1.45, 1.4) * softH * 1.8;
  col += vec3(1.3, 1.35, 1.5) * key * 4.5;
  // Cool fill only — no magenta fillM (magenta bowl killer)
  col += vec3(0.45, 0.7, 1.05) * fillM * 0.18;
  col += vec3(0.25, 1.05, 1.15) * fillC * 0.22;
  float star = pow(max(dot(rn, normalize(vec3(-0.4, 0.82, 0.4))), 0.0), 520.0);
  col += vec3(2.2) * star * 7.5;
  // Frontal softbox plate — soft peaks for planar wet-mirror
  vec3 plate = texture(u_backdrop, studioPlateUv(rn)).rgb;
  float platePeak = max(plate.r, max(plate.g, plate.b));
  float hard = smoothstep(0.35, 0.78, platePeak);
  float soft = smoothstep(0.06, 0.38, platePeak) * (1.0 - hard * 0.7);
  col += plate * soft * 0.55;
  col += plate * hard * 3.8;
  return col;
}

/** Spectral edge fire: cyan ↔ lime ↔ gold (pink 0 — no magenta wash). */
vec3 edgeFire(float t, float amt) {
  vec3 cyan = vec3(0.2, 1.35, 1.4);
  vec3 lime = vec3(0.55, 1.4, 0.35);
  vec3 gold = vec3(1.35, 1.1, 0.35);
  vec3 silver = vec3(0.95, 1.0, 1.08);
  float u = smoothstep(0.0, 1.0, t);
  vec3 fire = mix(cyan, lime, smoothstep(0.1, 0.55, u));
  fire = mix(fire, gold, smoothstep(0.5, 0.95, u));
  fire = mix(fire, silver, 0.28);
  return fire * amt;
}

/** Planar oil-slick only: lime ↔ gold (no cyan milk / pink). */
vec3 oilFire(float t, float amt) {
  vec3 lime = vec3(0.42, 1.38, 0.22);
  vec3 gold = vec3(1.38, 1.12, 0.22);
  vec3 chrome = vec3(0.92, 0.94, 0.96);
  float u = smoothstep(0.0, 1.0, t);
  vec3 fire = mix(lime, gold, u);
  fire = mix(chrome, fire, 0.88);
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
  float halfSpread = (baseIor - 1.0) * 0.036 * dispAmt;
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
  for (int i = 0; i < 48; i++) {
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
  // Glyph QA: cap fwidth — SwiftShader can return huge derivatives and soft-mask the
  // whole canvas into chrome (pastel wash / false face fill outside the letter).
  float aa = u_fieldMode > 0.5 ? min(fwidth(d) * 1.25, 0.012) : fwidth(d) * 1.5;
  float mask = 1.0 - smoothstep(-aa, aa, d);

  if (mask < 0.001 || (u_fieldMode > 0.5 && d > 0.035)) {
    // Opaque dark plate — SwiftShader treats cleared alpha as white otherwise
    outColor = vec4(0.031, 0.031, 0.039, 1.0);
    return;
  }

  vec2 g = gradField(p, halfSize, radius);
  float edge = smoothstep(0.08, 0.0, abs(d));
  float inside = max(-d, 0.0);
    // Glyph: chrome lip — script: razor rim only so tubular face stays luminous
    float bevelW = u_fieldMode > 0.5
      ? (u_glyphId > 0.5 ? mix(0.0012, 0.0042, u_bevel) : mix(0.012, 0.028, u_bevel))
      : mix(0.055, 0.11, u_bevel);
    float rim = 1.0 - smoothstep(0.0, bevelW, inside);
    // Script: high pow → only extreme lip is rim; body reads as filled tube
    float rimSharp = pow(rim, u_glyphId > 0.5 ? 4.4 : 1.45);
  float z = u_bevel * edge * 0.85;
  vec3 N;
  if (u_fieldMode > 0.5) {
    // MSDF height bevel — planar knife plateau (chrome) / tubular crest (script)
    float hAtlas = u_useGlyphAtlas > 0.5 ? glyphAtlasHeight(p) : 0.0;
    float hT = clamp(inside / max(bevelW * (u_glyphId > 0.5 ? 10.0 : 3.2), 1e-4), 0.0, 1.0);
    float hAnalytic = u_glyphId > 0.5
      ? sqrt(max(0.001, 1.0 - pow(1.0 - hT, 2.0)))
      : mix(smoothstep(0.0, 0.42, hT), 1.0, smoothstep(0.32, 0.78, hT));
    float height = mix(hAnalytic, hAtlas, u_useGlyphAtlas > 0.5 ? 0.85 : 0.0);
    // Height gradient → bevel normal (finite difference in field space)
    float eH = 0.0035;
    float hdx = (u_useGlyphAtlas > 0.5 ? glyphAtlasHeight(p + vec2(eH, 0.0)) : hAnalytic)
      - (u_useGlyphAtlas > 0.5 ? glyphAtlasHeight(p - vec2(eH, 0.0)) : hAnalytic);
    float hdy = (u_useGlyphAtlas > 0.5 ? glyphAtlasHeight(p + vec2(0.0, eH)) : hAnalytic)
      - (u_useGlyphAtlas > 0.5 ? glyphAtlasHeight(p - vec2(0.0, eH)) : hAnalytic);
    // For analytic fallback, approximate height grad from SDF grad + profile
    if (u_useGlyphAtlas < 0.5) {
      float dh = u_glyphId > 0.5 ? (1.0 - hT) / max(bevelW * 10.0, 1e-4) : step(hT, 0.45) * 2.4 / max(bevelW * 3.2, 1e-4);
      hdx = g.x * dh * eH * 2.0;
      hdy = g.y * dh * eH * 2.0;
    }
    vec3 dripN = dripNormalBias(p);
    if (u_glyphId < 0.5) {
      // Planar knife: face normal ≈ Z on plateau; bevel only at lip
      // Kill height-noise tilt on face — fragmented reflection UV was cyan-washing faces
      float faceFlat = smoothstep(0.12, 0.72, height) * (1.0 - rimSharp);
      float gAmt = mix(0.004, 1.55, rimSharp) * (0.9 + 0.5 * u_bevel);
      N = normalize(vec3(
        g * gAmt * (1.0 - faceFlat * 0.98) - vec2(hdx, hdy) * 3.5 * (1.0 - faceFlat),
        mix(0.55, 1.0, faceFlat) + dripN.z * 0.18
      ));
    } else {
      // Round pipe elegance (ENj9B): tighter cylinder — crest high-Z, flanks steep
      float bodyT = clamp(inside / 0.072, 0.0, 1.0);
      float flankAmt = 1.0 - pow(bodyT, 0.42); // sharper crest / darker flanks
      float tube = mix(0.45, 4.2, flankAmt);
      vec2 hGrad = vec2(hdx, hdy) * mix(0.9, 4.0, flankAmt);
      float crestZ = mix(1.05, 0.16, flankAmt) * mix(1.0, 0.28, rimSharp);
      vec3 Ntube = normalize(vec3(
        g * tube - hGrad + dripN.xy * 0.55,
        crestZ + dripN.z * 0.35
      ));
      N = Ntube;
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
    // Metal-ish: higher base F0 so faces read as wet mirror (not dark plastic)
    float F0m = 0.42;
    fres = F0m + (1.0 - F0m) * pow(1.0 - ndotv, 2.6);
    fres = clamp(fres * (0.55 + 0.7 * rimSharp) + rimSharp * 0.35, 0.0, 1.0);
  }

  vec3 color;
  if (u_fieldMode > 0.5) {
    // --- Concept-HDRI wet mirror: reflection-mapped plate + height bevel ---
    // Chrome: planar knife faces (silver softbox / black voids) — 1c6PD/Z53Ve
    // Script: tubular silver wrap ribbons on charcoal pipe — ENj9B (no icy flood)
    float faceBend = u_glyphId > 0.5 ? 1.7 : 0.004;
    vec3 Ncurve = normalize(vec3(
      p * vec2(faceBend, faceBend * 0.78) * (0.35 + 0.4 * u_bevel),
      u_glyphId > 0.5 ? 0.38 : 0.999
    ));
    vec3 Rface = reflect(-V, N);
    vec3 Rlight = normalize(mix(Rface, reflect(-L, N), u_glyphId > 0.5 ? 0.42 : 0.02));
    vec3 envFace = studioEnv(Rlight);
    vec3 envRim = studioEnv(R);
    vec3 env = mix(envFace, envRim, rimSharp * 0.5);

    vec2 plateUv = studioPlateUv(Rlight);
    // Planar: soft 2D softbox sample (NOT vertical column UV). Script wraps cylindrically.
    vec2 facePlateUv = clamp(
      u_glyphId > 0.5
        ? studioPlateUv(normalize(mix(Rlight, reflect(-V, Ncurve), 0.72)))
        // Planar oil-slick: sample bright softbox cluster across WHOLE face (anti hollow upper)
        : vec2(0.46, 0.36) + p * vec2(0.18, 0.22) + vec2(Rlight.x * 0.08, Rlight.y * 0.06) + vec2(ndotl * 0.03, fres * 0.02),
      0.0, 1.0
    );
    vec3 plate = texture(u_backdrop, plateUv).rgb;
    // Face: wide H+V blur — planar wet-mirror softbox (kill residual shred / barcode)
    vec2 pxH = vec2(6.0 / max(u_resolution.x, 1.0), 0.0);
    vec2 pxV = vec2(0.0, 6.0 / max(u_resolution.y, 1.0));
    vec3 facePlate = texture(u_backdrop, facePlateUv).rgb * 0.28
      + texture(u_backdrop, clamp(facePlateUv + pxH, 0.0, 1.0)).rgb * 0.14
      + texture(u_backdrop, clamp(facePlateUv - pxH, 0.0, 1.0)).rgb * 0.14
      + texture(u_backdrop, clamp(facePlateUv + pxV, 0.0, 1.0)).rgb * 0.14
      + texture(u_backdrop, clamp(facePlateUv - pxV, 0.0, 1.0)).rgb * 0.14
      + texture(u_backdrop, clamp(facePlateUv + pxH * 2.0, 0.0, 1.0)).rgb * 0.08
      + texture(u_backdrop, clamp(facePlateUv - pxH * 2.0, 0.0, 1.0)).rgb * 0.08;
    // Soft contrast — wet mirror (not hard panel knife)
    facePlate = vec3(
      pow(max(facePlate.r, 0.0), 1.15),
      pow(max(facePlate.g, 0.0), 1.15),
      pow(max(facePlate.b, 0.0), 1.15)
    );
    facePlate = clamp((facePlate - 0.04) * 1.35, 0.0, 1.55);
    if (u_glyphId < 0.5) {
      // Planar oil-slick: diagonal + elliptical puddles (NOT vertical slabs)
      float oph = fract(dot(p, vec2(0.9, 1.55)) * 0.7 + Rlight.x * 0.2 + ndotl * 0.3);
      vec3 ofire = oilFire(oph, 0.75);
      float oL = max(dot(ofire, vec3(0.2126, 0.7152, 0.0722)), 0.2);
      float fL = max(dot(facePlate, vec3(0.2126, 0.7152, 0.0722)), 0.18);
      float ellOil = exp(-dot((p - vec2(0.02, 0.0)) * vec2(1.8, 2.4), (p - vec2(0.02, 0.0)) * vec2(1.8, 2.4)));
      ellOil = max(ellOil, 0.7 * exp(-dot((p - vec2(0.1, -0.12)) * vec2(2.0, 2.2), (p - vec2(0.1, -0.12)) * vec2(2.0, 2.2))));
      float oWash = 0.4 + 0.6 * pow(0.5 + 0.5 * cos(dot(p, vec2(1.15, 1.85)) + ndotl), 0.85);
      oWash *= (0.55 + 0.45 * ellOil);
      // Lift dark plate samples so upper face never collapses
      facePlate = max(facePlate, vec3(0.55, 0.58, 0.62) * (0.6 + 0.4 * fL));
      facePlate = mix(facePlate, ofire * (max(fL, 0.4) / oL), oWash * 0.22);
    }
    plate = vec3(
      pow(max(plate.r, 0.0), 1.2),
      pow(max(plate.g, 0.0), 1.2),
      pow(max(plate.b, 0.0), 1.2)
    );
    float platePeak = max(plate.r, max(plate.g, plate.b));
    float facePeak = max(facePlate.r, max(facePlate.g, facePlate.b));
    float faceChromaP = max(abs(facePlate.r - facePlate.g), max(abs(facePlate.g - facePlate.b), abs(facePlate.r - facePlate.b)));
    float hardBar = smoothstep(0.28, 0.75, platePeak);
    float faceHard = smoothstep(0.22, 0.72, facePeak);
    float panelAlive = smoothstep(0.14, 0.58, facePeak);

    vec3 darkBody = u_glyphId > 0.5
      ? vec3(0.07, 0.072, 0.09)
      : vec3(0.0, 0.0, 0.0);
    vec3 ambTint = u_glyphId > 0.5
      ? vec3(0.24, 0.26, 0.3)
      : vec3(0.02, 0.025, 0.03);
    float faceAlive = (1.0 - rimSharp) * u_glass;

    color = darkBody;
    float mirrorAmt = mix(u_glyphId > 0.5 ? 0.78 : 0.98, 1.0, fres) * u_glass;
    vec3 mir = facePlate * (0.45 + 1.15 * hardBar);
    mir = max(mir, envFace * (u_glyphId > 0.5 ? 0.4 : 0.28) * hardBar);
    if (u_glyphId < 0.5) {
      float pinkP = max(0.0, mir.r - mir.g * 1.02) * max(0.0, mir.b - mir.g * 0.85);
      mir.r -= pinkP * 1.0;
      mir.b -= pinkP * 0.75;
      float creamP = max(0.0, mir.r - mir.b * 1.02);
      mir.r -= creamP * 0.85;
      mir.g -= creamP * 0.5;
      // Cyan milk → silver; spare lime/gold + high-chroma oil fringe
      float cyanWash = max(0.0, mir.b - mir.r * 0.92) * (1.0 - smoothstep(0.1, 0.3, faceChromaP));
      float limeKeep = smoothstep(0.08, 0.28, faceChromaP) * step(mir.b + 0.02, mir.g) * step(mir.r + 0.05, mir.g);
      float goldKeep = smoothstep(0.08, 0.28, faceChromaP) * step(mir.b + 0.05, mir.r) * step(mir.b + 0.02, mir.g);
      float silverL = dot(mir, vec3(0.2126, 0.7152, 0.0722));
      mir = mix(mir, vec3(silverL * 0.97, silverL * 1.0, silverL * 1.04), clamp(cyanWash * 0.9 * (1.0 - limeKeep) * (1.0 - goldKeep), 0.0, 0.7));
      mir *= mix(0.22, 1.45, panelAlive);
    }
    color = mix(darkBody, mir * (u_glyphId > 0.5 ? 1.45 : 1.95), mirrorAmt * faceAlive);
    if (u_glyphId < 0.5) {
      // Soft luminance voids — keep face floor (anti hollow upper bowl)
      float softPanel = mix(0.72, 1.0, smoothstep(0.06, 0.48, facePeak));
      softPanel = max(softPanel, panelAlive * 0.8);
      // Prefer bright facePlate floor (anti hollow) — don't lean on darkBody mix
      color = mix(facePlate * 0.85, color, softPanel);
      color += facePlate * faceHard * 1.15 * u_glass * faceAlive * softPanel;
      color += plate * hardBar * 0.45 * u_glass * faceAlive * softPanel;
      color += vec3(1.15, 1.2, 1.28) * pow(faceHard, 2.2) * 0.75 * u_glass * faceAlive * softPanel;
      float cyanFace = max(0.0, color.b - color.r * 0.94);
      float pinkFace = max(0.0, color.r - color.g * 1.0) * max(0.0, color.b - color.g * 0.85);
      float limeKeep2 = step(color.b + 0.02, color.g) * step(color.r + 0.04, color.g);
      color = mix(color, facePlate * softPanel * 0.95, clamp((cyanFace * 0.6 + pinkFace * 1.25) * faceAlive * (1.0 - limeKeep2), 0.0, 0.78));
      color.r -= pinkFace * 1.0 * faceAlive;
      color.b -= pinkFace * 0.75 * faceAlive;
      float lavM = max(0.0, color.b - color.r * 0.98) * (1.0 - limeKeep2);
      float sL = dot(color, vec3(0.2126, 0.7152, 0.0722));
      // Unequal silver (capture strips equal RGB≥248)
      color = mix(color, vec3(sL * 0.96, sL * 1.0, sL * 1.05), clamp(lavM * 0.85 * faceAlive, 0.0, 0.7));
      color = max(color, facePlate * 0.75 * faceAlive);
      color = max(color, vec3(0.48, 0.52, 0.55) * faceAlive);
    } else {
      color += plate * hardBar * 0.28 * u_glass * faceAlive;
      color += facePlate * faceHard * 0.32 * u_glass * faceAlive;
      color += envFace * hardBar * 0.22 * u_glass * faceAlive;
    }
    color = max(color, darkBody * (u_glyphId > 0.5 ? 1.4 : 1.0) * faceAlive);

    if (u_glyphId > 0.5) {
      // Round tubular pipe (ENj9B): sharp medial crest, dark flanks, elegant silver ribbon
      float tubeBody = smoothstep(0.0, max(bevelW * 0.7, 0.0015), inside);
      float bodyT = clamp(inside / 0.072, 0.0, 1.0);
      float crest = pow(bodyT, 0.42); // sharp crest (round cross-section)
      float flank = 1.0 - crest;
      float wrapFres = pow(1.0 - ndotv, 1.15); // rim wrap for pipe lip
      float tubeCatch = pow(max(dot(N, H), 0.0), 48.0);
      float hemi = 0.28 + 0.72 * max(dot(N, L), 0.0);
      float medial = exp(-pow((bodyT - 1.0) * 2.8, 2.0)) * crest;
      // Continuous crest ribbon + flank falloff — round-pipe elegance
      float silRibbon = clamp(
        crest * hemi * 1.15 + wrapFres * 0.55 + tubeCatch * 0.75 + medial * 0.55,
        0.0, 1.0
      );
      vec3 charcoal = vec3(0.08, 0.082, 0.095);
      vec3 midMetal = vec3(0.42, 0.425, 0.44);
      vec3 silverWrap = vec3(0.98, 0.98, 0.99);
      silverWrap *= (0.35 + 1.35 * crest * hemi + 1.05 * wrapFres);
      silverWrap += vec3(1.12) * tubeCatch * 2.0;
      float silAmt = clamp(pow(silRibbon, 0.72) * 1.05, 0.0, 0.96);
      // Cylinder shade: dark flank → bright crest (Lambert-ish round pipe)
      float cylShade = clamp(pow(crest, 0.85) * hemi * 1.2 + wrapFres * 0.28, 0.0, 1.0);
      vec3 tubeFill = mix(charcoal, midMetal, cylShade);
      tubeFill = mix(tubeFill, silverWrap, silAmt);
      tubeFill = mix(tubeFill, charcoal * 0.85, flank * (1.0 - silAmt) * 0.72);
      float faceAmt = mix(0.99, 0.18, rimSharp) * u_glass * mix(0.92, 1.0, tubeBody);
      color = mix(charcoal, tubeFill, faceAmt);
      color = max(color, silverWrap * silAmt * 0.9);
      color = max(color, midMetal * crest * hemi * 0.85);
    } else {
      // Soft planar oil — accents only on silver softbox (anti neon flood)
      float faceIris = faceAlive * (1.0 - rimSharp * 0.12);
      float irisPhase = fract(dot(p, vec2(0.75, 1.25)) * 0.4 + ndotl * 0.5 + fres * 0.35);
      float ellIris = exp(-dot((p - vec2(-0.02, 0.04)) * vec2(1.6, 2.1), (p - vec2(-0.02, 0.04)) * vec2(1.6, 2.1)));
      ellIris = max(ellIris, 0.65 * exp(-dot((p - vec2(0.12, -0.1)) * vec2(1.9, 2.3), (p - vec2(0.12, -0.1)) * vec2(1.9, 2.3))));
      float oilWash = (0.5 + 0.5 * cos(dot(p, vec2(1.05, 1.7)) + ndotl)) * (0.35 + 0.65 * ellIris);
      vec3 irisA = oilFire(irisPhase, 0.45);
      vec3 irisB = oilFire(fract(irisPhase + 0.33), 0.35);
      float baseL = max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.25);
      vec3 oilMix = mix(irisA, irisB, clamp(oilWash, 0.0, 1.0));
      float oilL = max(dot(oilMix, vec3(0.2126, 0.7152, 0.0722)), 0.2);
      color = mix(color, oilMix * (baseL / oilL) * 1.05, faceIris * 0.22 * u_dispersion);
      color += (irisA - 0.5) * faceIris * ellIris * 0.14 * u_dispersion * u_glass;
      float softGlint = pow(max(faceHard, 0.4), 1.8) * faceAlive;
      color += vec3(1.25, 1.28, 1.32) * softGlint * 0.85 * u_glass;
      color = max(color, facePlate * 0.8 * faceAlive);
      color = max(color, vec3(0.5, 0.54, 0.58) * faceAlive * (1.0 - rimSharp * 0.5));
    }

    vec2 e = Rlight.xy / (abs(Rlight.z) + 0.22);
    // Soft elliptical glints only — kill vertical barcode streak cores on chrome faces
    float streakCore = exp(-dot((e - vec2(-0.18, 0.2)) * vec2(3.5, 2.2), (e - vec2(-0.18, 0.2)) * vec2(3.5, 2.2)));
    streakCore += 0.7 * exp(-dot((e - vec2(0.28, 0.12)) * vec2(3.2, 2.4), (e - vec2(0.28, 0.12)) * vec2(3.2, 2.4)));
    float streakShoulder = u_glyphId < 0.5 ? faceHard * faceAlive : 0.08;
    if (u_glyphId < 0.5) streakCore *= 0.35 * faceAlive;
    float barMul = u_glyphId > 0.5 ? 1.0 : 0.4;
    color += vec3(1.9, 1.95, 2.0) * streakCore * barMul * u_glass;
    color += vec3(1.0, 0.98, 0.95) * streakShoulder * 0.12 * u_glass;

    if (u_glyphId > 0.5) {
      float tubeAlive = smoothstep(0.0, max(bevelW * 0.7, 0.0015), inside);
      float bodyT2 = clamp(inside / 0.072, 0.0, 1.0);
      float crest2 = pow(bodyT2, 0.42);
      float wrapFres2 = pow(1.0 - ndotv, 1.1);
      float hemiPost = 0.28 + 0.72 * max(dot(N, L), 0.0);
      float medial2 = exp(-pow((bodyT2 - 1.0) * 2.8, 2.0)) * crest2 * 0.6;
      color += vec3(0.94, 0.96, 0.99) * wrapFres2 * faceAlive * 0.85 * u_glass;
      color += vec3(0.97, 0.98, 1.0) * crest2 * hemiPost * 1.05 * u_glass * faceAlive;
      color += vec3(0.92, 0.94, 0.97) * medial2 * 1.1 * u_glass;
      color = max(color, vec3(0.1, 0.105, 0.125) * tubeAlive * u_glass);
      color = max(color, envFace * vec3(0.5, 0.52, 0.56) * 0.14 * tubeAlive * u_glass);
      float flatW = smoothstep(0.62, 1.25, dot(color, vec3(0.2126, 0.7152, 0.0722)));
      float chromaW = max(abs(color.r - color.g), abs(color.g - color.b));
      float silSpare = clamp(wrapFres2 * 1.0 + crest2 * hemiPost * 1.15 + medial2 * 1.2 + pow(max(dot(N, H), 0.0), 32.0) * 1.1, 0.0, 1.0);
      color = mix(
        color,
        vec3(0.09, 0.095, 0.115) + vec3(0.28, 0.3, 0.34) * wrapFres2,
        flatW * (1.0 - smoothstep(0.03, 0.12, chromaW)) * (1.0 - silSpare * 0.92) * 0.78 * tubeAlive
      );
      float icyTint = max(0.0, color.b - color.r * 0.98);
      float silL = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color, vec3(silL * 0.99, silL * 1.0, silL * 1.02), clamp(icyTint * 0.75 * tubeAlive * (1.0 - silSpare * 0.45), 0.0, 0.6));
    }

    float specRim = mix(u_glyphId < 0.5 ? max(0.25, streakShoulder) : 0.06, 1.0, rimSharp);
    // Soft lime/gold accents — elliptical, not vertical barcode streaks
    color += vec3(0.85, 1.15, 0.55) * exp(-dot((e - vec2(0.1, 0.15)) * vec2(4.0, 2.5), (e - vec2(0.1, 0.15)) * vec2(4.0, 2.5))) * 0.35 * specRim;
    color += vec3(1.15, 1.05, 0.4) * exp(-dot((e + vec2(0.05, -0.1)) * vec2(3.8, 2.8), (e + vec2(0.05, -0.1)) * vec2(3.8, 2.8))) * 0.38 * specRim;
    color += vec3(1.2, 1.25, 0.4) * exp(-pow((e.y - 0.2) * 4.5, 2.0)) * 0.32 * mix(u_glyphId < 0.5 ? max(0.3, streakShoulder) : 0.1, 1.0, rimSharp);

    color = max(color, vec3(0.0));
    // Contrast expand — crush milky cream mids, keep planar knife + iridescent peaks
    if (u_glyphId < 0.5) {
      float cl = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float faceChroma = max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b)));
      // Mild contrast — keep planar face floor (don't crush mid softbox to void)
      color = mix(color * 0.55, color * 1.25, smoothstep(0.12, 1.4, cl));
      float cream = max(0.0, color.r - color.b * 1.05);
      cream = max(cream, max(0.0, color.g * 0.85 - color.b));
      cream = max(cream, max(0.0, color.r - color.g * 0.9) * 0.6);
      float creamL = smoothstep(0.65, 1.5, cl) * faceAlive;
      float coolPeak = smoothstep(0.0, 0.04, color.b - color.r);
      float irisPeak = smoothstep(0.05, 0.2, faceChroma);
      color = mix(color, color * vec3(0.9, 0.92, 0.95), clamp(cream * 2.2 * creamL * (1.0 - coolPeak) * (1.0 - irisPeak), 0.0, 0.55));
      color.r -= cream * 0.45 * creamL * (1.0 - coolPeak) * (1.0 - irisPeak);
      color.g -= cream * 0.25 * creamL * (1.0 - coolPeak) * (1.0 - irisPeak);
      color = max(color, vec3(0.42, 0.46, 0.5) * faceAlive);
    }

    vec2 T = normalize(vec2(-g.y, g.x) + 1e-5);
    float aniso = pow(max(1.0 - abs(dot(normalize(R.xy + 1e-5), T)), 0.0), 3.8);
    float anisoAmt = u_glyphId > 0.5 ? (0.32 + 0.5 * rimSharp) : (0.0 + 0.1 * rimSharp);
    color += env * aniso * anisoAmt;

    if (u_glyphId > 0.5) {
      float spine = exp(-pow(inside / 0.048, 2.0) * 0.35) * (1.0 - rimSharp * 0.12);
      float wrapFresS = pow(1.0 - ndotv, 1.0);
      float tubeAliveS = smoothstep(0.0, max(bevelW * 0.75, 0.0015), inside);
      color += vec3(1.0, 1.02, 1.06) * spine * wrapFresS * 2.2 * u_glass;
      color += envFace * spine * vec3(0.9, 0.92, 0.96) * 0.75;
      color = max(color, vec3(0.15, 0.16, 0.19) * tubeAliveS * u_glass);
      color = max(color, ambTint * 0.45 * tubeAliveS * u_glass);
      float joinZone = exp(-pow(length(p - vec2(-0.055, 0.07)) / 0.16, 2.0));
      color += vec3(0.95, 0.97, 1.0) * joinZone * wrapFresS * tubeAliveS * 1.35 * u_glass;
      color = max(color, envFace * joinZone * 0.75 * tubeAliveS * u_glass);
    }

    vec3 rimCol = mix(vec3(1.25, 1.32, 1.4), envRim * 2.4, 0.7);
    color = mix(color, max(color, rimCol), rimSharp * (u_glyphId > 0.5 ? 0.55 : 0.4) * (0.7 + 0.25 * fres));

    if (u_glyphId > 0.5) {
      color = mix(color, color * vec3(0.95, 1.0, 1.06), mix(0.04, 0.18, rimSharp));
    } else {
      color = mix(color, max(color, rimCol * vec3(0.95, 0.98, 1.02)), rimSharp * 0.28);
      color = mix(color, color * vec3(0.94, 0.97, 1.02), rimSharp * 0.12);
    }

    float faceGate = 1.0 - rimSharp;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float crush = u_glyphId < 0.5
      ? smoothstep(0.75, 1.65, luma) * faceGate * 0.28 * max(0.0, 1.0 - (color.b - color.r) * 4.0)
      : smoothstep(2.4, 3.8, luma) * faceGate * 0.1;
    color = mix(color, color * (u_glyphId < 0.5 ? 0.55 : 0.82), crush);

    float specSoft = pow(max(dot(N, H), 0.0), 36.0);
    float specMid = pow(max(dot(N, H), 0.0), 110.0);
    float specStar = pow(max(dot(N, H), 0.0), 480.0);
    float specFace = pow(max(dot(Ncurve, H), 0.0), 64.0);
    vec3 L2 = normalize(vec3(0.6, 0.3, 0.85) - vec3(p, 0.0) * 0.2);
    vec3 H2 = normalize(L2 + V);
    float spec2 = pow(max(dot(N, H2), 0.0), 200.0);
    float li = u_lightIntensity * u_specular;
    float specFaceGate = u_glyphId < 0.5 ? mix(0.15, 1.0, rimSharp) : 1.0;
    color += vec3(1.1, 1.05, 0.98) * specFace * 0.7 * li * faceGate * specFaceGate;
    color += vec3(1.05, 1.0, 0.95) * specSoft * 0.45 * li * mix(0.5, 1.0, rimSharp) * specFaceGate;
    color += vec3(1.28, 1.22, 1.15) * specMid * 1.15 * li * (u_glyphId < 0.5 ? mix(0.25, 1.0, rimSharp) : 1.0);
    color += vec3(1.55, 1.45, 1.35) * specStar * 3.8 * li * (u_glyphId < 0.5 ? mix(0.35, 1.0, rimSharp) : 1.0);
    color += vec3(1.1, 0.92, 1.2) * spec2 * 0.9 * li * specFaceGate;
    float envStar = pow(max(dot(N, normalize(vec3(-0.45, 0.8, 0.5))), 0.0), 300.0);
    color += vec3(1.5, 1.4, 1.55) * envStar * 2.8 * li * mix(0.55, 1.0, rimSharp) * specFaceGate;

    float fireAmt = u_dispersion * (1.05 + 1.3 * fres) * mix(0.5, 1.95, rimSharp);
    fireAmt *= clamp(u_lightIntensity * 0.58, 0.85, 2.7);
    fireAmt *= (0.65 + 0.85 * lightDisp);
    if (u_glyphId < 0.5) fireAmt *= mix(0.08, 0.42, rimSharp); // rim-led fire; face via streak oil only
    float fireBand = pow(rim, 0.8) * mix(0.8, 1.45, rimSharp);
    float fireT = fract(ndotl * 2.5 + fres * 0.95 + length(p) * 1.25 + rimSharp * 0.48);
    float lightSide = smoothstep(-0.16, 0.92, ndotl);
    // Chrome/script: cyan/lime/gold only (pink 0)
    vec3 fireA = edgeFire(mix(0.9, 0.1, lightSide), fireAmt * fireBand * (u_glyphId < 0.5 ? 0.7 : 1.0));
    vec3 fireB = edgeFire(mix(0.16, 0.8, lightSide), fireAmt * fireBand * 0.75 * max(lightDisp, 0.48));
    if (u_glyphId < 0.5) {
      fireA *= vec3(0.45, 1.05, 0.95);
      fireB *= vec3(0.4, 1.1, 0.9);
    } else {
      fireA *= vec3(0.75, 0.95, 1.05);
      fireB *= vec3(0.7, 0.98, 1.08);
    }
    color += fireA * (u_glyphId < 0.5 ? mix(0.08, 0.7, rimSharp) : 0.4);
    color += fireB * (u_glyphId < 0.5 ? mix(0.06, 0.55, rimSharp) : 0.35);
    if (u_glyphId > 0.5) {
      color += edgeFire(fireT, fireAmt * edge * 0.28) * vec3(0.75, 0.95, 1.05);
    } else {
      color += edgeFire(fireT, fireAmt * edge * 0.3) * vec3(0.45, 1.05, 0.95) * rimSharp;
    }
    float outerFire = smoothstep(bevelW * 2.9, -aa * 0.6, d) * (1.0 - smoothstep(-aa, bevelW * 0.9, -d));
    color += edgeFire(0.28 + 0.45 * lightSide, outerFire * u_dispersion * (u_glyphId < 0.5 ? 0.28 : 0.5) * u_lightIntensity)
      * (u_glyphId < 0.5 ? vec3(0.5, 1.05, 0.95) : vec3(0.75, 0.95, 1.05));
    float halo = smoothstep(bevelW * 1.55, 0.0, inside) * (1.0 - rimSharp * 0.3);
    color += edgeFire(mix(0.18, 0.82, lightSide), halo * u_dispersion * 0.22 * (0.5 + 0.5 * lightDisp))
      * (u_glyphId < 0.5 ? vec3(0.4, 1.0, 0.95) * rimSharp : vec3(0.7, 0.95, 1.05) * 0.35);

    float film = u_filmThickness;
    if (film > 0.001) {
      float faceFilm = u_glyphId > 0.5
        ? faceGate * 0.18
        : faceGate * mix(0.7, 1.15, clamp(faceHard, 0.0, 1.0));
      float thick = film * (0.45 + 0.4 * rimSharp + 0.7 * faceFilm);
      float filmStr = film * mix(0.45, 0.95, rimSharp) * (0.45 + 0.55 * ndotl);
      if (u_glyphId < 0.5) filmStr *= mix(0.85, 1.35, clamp(faceHard, 0.0, 1.0));
      vec3 filmTint = thinFilm(thick, ndotv, ndotl, filmStr);
      // Pink0 + cyan-milk crush on film; spare lime/gold oil-slick
      float fPink = max(0.0, filmTint.r - filmTint.g * 1.02) * max(0.0, filmTint.b - filmTint.g * 0.9);
      filmTint.r -= fPink * 0.9;
      filmTint.b -= fPink * 0.7;
      float fChroma = max(abs(filmTint.r - filmTint.g), max(abs(filmTint.g - filmTint.b), abs(filmTint.r - filmTint.b)));
      float fLime = step(filmTint.b + 0.02, filmTint.g) * step(filmTint.r + 0.04, filmTint.g);
      float fGold = step(filmTint.b + 0.08, filmTint.r) * step(filmTint.b + 0.02, filmTint.g);
      float fCyanMilk = max(0.0, filmTint.b - filmTint.r * 0.95) * (1.0 - smoothstep(0.08, 0.25, fChroma));
      float fSil = dot(filmTint, vec3(0.2126, 0.7152, 0.0722));
      filmTint = mix(filmTint, vec3(fSil), clamp(fCyanMilk * 0.85 * (1.0 - fLime) * (1.0 - fGold), 0.0, 0.7));
      color += (filmTint - 0.5) * filmStr * mix(1.05, 1.55, rimSharp) * (u_glyphId < 0.5 ? 1.55 : 0.55);
      color = mix(color, color * filmTint, film * faceFilm * (u_glyphId < 0.5 ? 0.55 : 0.12));
    }

    if (p.y < -0.02) {
      float dripZone = smoothstep(-0.01, -0.48, p.y);
      vec3 dripEnv = studioEnv(normalize(Rface + vec3(0.0, -0.4, 0.12)));
      float dripMix = u_glyphId > 0.5 ? 0.32 : 0.55;
      color = mix(color, max(color, dripEnv * vec3(1.15, 1.2, 1.35)), dripZone * (dripMix + 0.2 * rimSharp));
      color += vec3(1.25, 1.3, 1.4) * specStar * dripZone * (u_glyphId > 0.5 ? 1.4 : 2.4) * li;
      color += edgeFire(0.55 + 0.25 * ndotl, dripZone * u_dispersion * (u_glyphId > 0.5 ? 0.28 : 0.55));
      float dripFloor = u_glyphId > 0.5 ? 2.0 : 1.65;
      color = max(color, darkBody * dripFloor * dripZone * (1.0 - rimSharp * 0.35));
      if (u_glyphId > 0.5) {
        color = max(color, ambTint * 0.55 * dripZone * (1.0 - rimSharp * 0.3));
        color = max(color, vec3(0.28, 0.3, 0.38) * dripZone * u_glass);
        float junc = smoothstep(-0.05, -0.2, p.y) * smoothstep(-0.58, -0.28, p.y);
        float juncFres = pow(1.0 - ndotv, 1.25);
        color = max(color, vec3(0.32, 0.34, 0.42) * junc * u_glass);
        color = max(color, envFace * junc * 0.75 * u_glass);
        color += vec3(0.65, 0.7, 0.85) * junc * juncFres * 1.1 * u_glass;
      } else {
        color = max(color, vec3(0.35, 0.38, 0.45) * dripZone * u_glass);
        color = max(color, facePlate * dripZone * 1.2 * u_glass);
      }
      color += vec3(1.2, 1.2, 1.3) * envStar * dripZone * 1.4 * li;
    }

    color = mix(color, color + refracted * 0.18, rimSharp * 0.14 * u_glass);

    // Soft tone-map — script silver unequal (capture strips equal RGB≥248)
    float peak = max(color.r, max(color.g, color.b));
    color = color / (1.0 + peak * (u_glyphId > 0.5 ? 0.08 : 0.12));
    if (u_glyphId > 0.5) {
      // Round pipe chrome (ENj9B) — sharp crest/flank cylinder, silverRatio ~0.55
      float tubeAliveF = smoothstep(0.0, max(bevelW * 0.7, 0.0015), inside);
      float bodyTF = clamp(inside / 0.072, 0.0, 1.0);
      float crestFin = pow(bodyTF, 0.42);
      float flankFin = 1.0 - crestFin;
      float hemiFin = 0.28 + 0.72 * max(dot(N, L), 0.0);
      float wrapFresF = pow(1.0 - ndotv, 1.1);
      float silField = crestFin * hemiFin * 1.15 + wrapFresF * 0.42 + pow(max(dot(N, H), 0.0), 36.0) * 0.55;
      // Crest ribbon only — round pipe (not face-wide ice); silverRatio ~0.55
      float silCover = pow(smoothstep(0.38, 0.88, silField), 1.15);
      vec3 charcoal = vec3(0.07, 0.072, 0.085);
      vec3 midMetal = vec3(0.32, 0.325, 0.34);
      vec3 silverFil = vec3(0.94, 0.945, 0.955);
      float cylShade = clamp(pow(crestFin, 0.9) * hemiFin * 1.15 + wrapFresF * 0.25, 0.0, 1.0);
      color = mix(charcoal, midMetal, cylShade);
      color = mix(color, silverFil, silCover);
      color = max(color, vec3(0.88) * smoothstep(0.48, 0.9, silCover));
      // Dark flanks = round cross-section read (ENj9B elegance)
      color = mix(color, charcoal * 0.82, flankFin * (1.0 - silCover) * 0.78);
      color = max(color, midMetal * crestFin * hemiFin * 0.7);
      color = max(color, vec3(0.12, 0.125, 0.135) * (0.25 + 0.75 * cylShade));
      color = max(color, vec3(0.1, 0.105, 0.115) * tubeAliveF);
      float pk = max(color.r, max(color.g, color.b));
      float chroma = max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b)));
      float icy = smoothstep(0.8, 0.98, pk) * (1.0 - smoothstep(0.03, 0.12, chroma));
      icy *= (1.0 - silCover * 0.85);
      color = mix(color, charcoal, clamp(icy * 0.85, 0.0, 0.85));
      float icyB = max(0.0, color.b - color.r * 1.0);
      float sL = (color.r + color.g + color.b) / 3.0;
      color = mix(color, vec3(sL), clamp(icyB * 1.2, 0.0, 0.9));
      color = clamp(color, 0.0, 0.99);
      float pinkBleed = max(0.0, color.r - color.g * 1.05) * max(0.0, color.b - color.g * 0.9);
      color.r -= pinkBleed * 0.95;
      color.b -= pinkBleed * 0.65;
      float creamBleed = max(0.0, color.r - color.b * 1.02);
      color.r -= creamBleed * 0.7;
      color.g -= creamBleed * 0.35;
      float tipZone = smoothstep(-0.05, -0.45, p.y);
      color = mix(color, charcoal + silverFil * silCover * 0.5, tipZone * (1.0 - silCover) * 0.45);
    } else {
      // Continuous planar oil-slick wet-mirror — NO barX / fract barcode
      // Soft elliptical softbox envelopes (planar wet-mirror, not vertical slabs)
      float ellA = exp(-dot((p - vec2(-0.04, 0.06)) * vec2(1.5, 2.0), (p - vec2(-0.04, 0.06)) * vec2(1.5, 2.0)));
      float ellB = exp(-dot((p - vec2(0.1, -0.08)) * vec2(1.7, 1.9), (p - vec2(0.1, -0.08)) * vec2(1.7, 1.9)));
      float ellC = exp(-dot((p - vec2(0.02, -0.18)) * vec2(2.0, 1.6), (p - vec2(0.02, -0.18)) * vec2(2.0, 1.6)));
      float softFace = clamp(0.55 + 0.45 * (ellA * 0.95 + ellB * 0.8 + ellC * 0.6 + faceHard * 0.35), 0.0, 1.0);
      // Silver softbox base — unequal RGB so capture won't strip equal≥248
      vec3 planar = max(facePlate, vec3(0.72, 0.76, 0.8));
      planar = planar * vec3(0.97, 1.0, 1.03);
      // Diagonal planar oil — accents only (wet-mirror, not neon flood)
      float oilPhase = fract(dot(p, vec2(0.7, 1.35)) * 0.5 + facePeak * 0.35 + ndotl * 0.3);
      float oilWash = 0.35 + 0.65 * pow(0.5 + 0.5 * cos(dot(p, vec2(1.1, 1.75)) + ndotl * 0.8), 0.9);
      oilWash *= (0.4 + 0.6 * softFace);
      float oilRipple = pow(0.5 + 0.5 * cos(dot(p, vec2(1.6, 2.4)) * 1.4 + fres), 1.4);
      vec3 oilA = oilFire(oilPhase, 0.65);
      vec3 oilB = oilFire(fract(oilPhase + 0.37), 0.5);
      float panL = max(dot(planar, vec3(0.2126, 0.7152, 0.0722)), 0.35);
      vec3 oilTint = mix(oilA, oilB, oilWash);
      float oilL = max(dot(oilTint, vec3(0.2126, 0.7152, 0.0722)), 0.2);
      vec3 oilChroma = oilTint * (panL / oilL);
      planar = mix(planar, oilChroma, oilWash * 0.26 * faceAlive);
      planar = planar + (oilA * 0.1 + oilB * 0.08) * oilWash * panL * softFace;
      planar = planar + (oilA * 0.06 + oilB * 0.05) * oilRipple * panL * softFace;
      // Continuous face fill — anti hollow + anti barcode
      color = mix(color, planar, faceAlive * softFace * 0.9);
      color = max(color, planar * faceAlive * 0.8);
      color = max(color, vec3(0.58, 0.62, 0.66) * faceAlive * (1.0 - rimSharp * 0.35));
      // Soft corner vignette only (NOT vertical columns)
      float vign = smoothstep(0.68, 0.32, length(p * vec2(1.1, 0.95)));
      color = mix(planar * 0.65, color, mix(0.9, 1.0, vign));
      color += (oilA - 0.5) * faceAlive * oilWash * softFace * 0.22 * u_dispersion;
      color += (oilB - 0.5) * faceAlive * oilWash * softFace * 0.16 * u_dispersion;
      color += (oilA - 0.5) * faceAlive * oilRipple * softFace * 0.1 * u_dispersion;
      color += vec3(1.05, 1.08, 1.12) * ellA * faceAlive * 0.5 * u_glass;
      color += vec3(0.95, 0.98, 1.02) * ellB * faceAlive * 0.38 * u_glass;
      float faceChroma2 = max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b)));
      float limeKeep = step(color.b + 0.02, color.g) * step(color.r + 0.03, color.g);
      float goldKeep = step(color.b + 0.06, color.r) * step(color.b + 0.02, color.g);
      float accentKeep = max(limeKeep, goldKeep) * smoothstep(0.04, 0.16, faceChroma2);
      float pinkF = max(0.0, color.r - color.g * 0.98) * max(0.0, color.b - color.g * 0.8);
      color.r -= pinkF * 1.0;
      color.b -= pinkF * 0.9;
      color = mix(color, planar * 0.85, clamp(pinkF * 2.2 * faceAlive, 0.0, 0.65));
      // Crush mint/lime flood → silver softbox; only spare tiny oil accents
      float mintFlood = max(0.0, color.g - color.r * 1.02) * max(0.0, color.g - color.b * 0.98);
      float silL2 = dot(color, vec3(0.2126, 0.7152, 0.0722));
      // accentKeep only protects when mint is weak (sparse oil); flood always crushed
      float spareOil = accentKeep * (1.0 - smoothstep(0.08, 0.25, mintFlood));
      color = mix(color, vec3(silL2 * 0.97, silL2 * 1.0, silL2 * 1.04), clamp(mintFlood * 1.15 * faceAlive * (1.0 - spareOil * 0.25), 0.0, 0.92));
      float cyanMilk = max(0.0, color.b - color.r * 0.94) * (1.0 - smoothstep(0.06, 0.22, faceChroma2));
      color = mix(color, vec3(silL2 * 0.97, silL2 * 1.0, silL2 * 1.04), clamp(cyanMilk * 0.9 * faceAlive, 0.0, 0.75));
      float lav2 = max(0.0, color.b - color.r * 0.98);
      color = mix(color, vec3(silL2 * 0.97, silL2 * 1.0, silL2 * 1.04), clamp(lav2 * 0.75 * faceAlive, 0.0, 0.6));
      // Final silver softbox grade — oil only in elliptical puddles (anti lime flood)
      float oilMask = clamp(ellA * 0.55 + ellB * 0.4 + ellC * 0.3, 0.0, 1.0) * oilWash;
      float baseSil = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 silverFace = vec3(baseSil * 0.97, baseSil * 1.0, baseSil * 1.05);
      color = mix(silverFace, color, clamp(0.12 + 0.4 * oilMask, 0.0, 0.55));
      // Hard guarantee: unequal channels + peak cap (SwiftShader capture strip)
      float pkC = max(color.r, max(color.g, color.b));
      if (pkC > 0.94) color *= 0.94 / pkC;
      color.r = min(color.r, 0.93);
      color.g = min(color.g, 0.94);
      color.b = min(color.b, 0.92);
      float forceCh = abs(color.r - color.g) + abs(color.g - color.b);
      color.r += step(forceCh, 0.04) * 0.015 * faceAlive;
      color.b += step(forceCh, 0.04) * 0.02 * faceAlive;
      color.g -= step(forceCh, 0.04) * 0.01 * faceAlive;
      color = clamp(color, 0.0, 0.97);
    }
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
  if (u_fieldMode > 0.5) {
    // Glyph QA: opaque composite (no SwiftShader white holes in capture/live)
    alpha = 1.0;
    // Soft edge into dark plate — keep AA thin; script holds body via cover curve
    vec3 plate = vec3(0.031, 0.031, 0.039);
    float cover = u_glyphId > 0.5
      ? smoothstep(0.15, 0.85, mask)
      : smoothstep(0.05, 0.95, mask);
    color = mix(plate, color, cover);
  }

  // Premultiplied alpha output
  outColor = vec4(color * alpha, alpha);
}
`;
