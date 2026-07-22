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
uniform sampler2D u_conceptFace; // atlas-UV concept chrome crop (hybrid photo-plate)
uniform float u_useConceptFace;  // 1 = faceplate ready
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
    // Script: softMin pipe join — stem↔loop necks only (atlas void fill + residual shader bridge)
    float jScale = u_useGlyphAtlas > 0.5 ? 0.88 : 0.95;
    float jNeck = length(p - vec2(-0.1, 0.06)) - 0.062 * jScale;
    float jNeck2 = length(p - vec2(-0.12, 0.12)) - 0.055 * jScale;
    float jNeck3 = length(p - vec2(-0.08, 0.0)) - 0.052 * jScale;
    float jNeck4 = length(p - vec2(-0.14, 0.02)) - 0.048 * jScale;
    float jCap = sdCapsule(p, vec2(-0.14, 0.16), vec2(-0.06, -0.02), 0.046 * jScale);
    float jCap2 = sdCapsule(p, vec2(-0.11, 0.1), vec2(-0.05, 0.04), 0.042 * jScale);
    float jCap3 = sdCapsule(p, vec2(-0.13, 0.04), vec2(-0.07, -0.08), 0.04 * jScale);
    float jK = mix(0.058, 0.048, u_useGlyphAtlas);
    d = softMin(d, jNeck, jK);
    d = softMin(d, jNeck2, jK * 0.95);
    d = softMin(d, jNeck3, jK * 0.92);
    d = softMin(d, jNeck4, jK * 0.9);
    d = softMin(d, jCap, jK * 0.95);
    d = softMin(d, jCap2, jK * 0.92);
    d = softMin(d, jCap3, jK * 0.9);
  } else {
    // Chrome: Blender silhouette already has clean stem–bowl join — skip procedural notches
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
  // Oil-slick accents: gold↔lime lead, cyan whisper (pink0) — spare softbox silver
  float w = 0.5 + 0.5 * cos(phase);
  float w2 = 0.5 + 0.5 * cos(phase * 1.35 + 1.1);
  vec3 gold = vec3(1.42, 1.12, 0.28);
  vec3 lime = vec3(0.45, 1.32, 0.28);
  vec3 cyan = vec3(0.36, 0.88, 0.98);
  vec3 fringe = mix(gold, lime, w);
  fringe = mix(fringe, cyan, w2 * 0.08);
  fringe = mix(vec3(0.88, 0.9, 0.94), fringe, 0.85);
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
  // Soft softbox peaks + oil accents (cyan/lime/gold — not neon flood)
  col += vec3(2.05, 2.0, 1.95) * softA * 4.2;
  col += vec3(1.85, 1.9, 1.95) * softB * 3.6;
  col += vec3(1.65, 1.38, 0.7) * softC * 1.35; // gold oil whisper, not lime flood
  col += vec3(1.5, 1.45, 1.4) * softH * 1.8;
  col += vec3(1.3, 1.35, 1.5) * key * 4.5;
  // Cool fill — keep mint low
  col += vec3(0.55, 0.7, 0.95) * fillM * 0.15;
  col += vec3(0.7, 0.88, 0.72) * fillC * 0.1;
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

/** Planar oil-slick: gold-led puddles + lime whisper — no cyan softbox. */
vec3 oilFire(float t, float amt) {
  vec3 gold = vec3(1.22, 0.9, 0.3);
  vec3 lime = vec3(0.58, 0.92, 0.36);
  vec3 charcoal = vec3(0.24, 0.26, 0.3);
  float u = smoothstep(0.0, 1.0, t);
  // Gold primary; lime secondary only (cyan softbox residual killed)
  vec3 fire = mix(gold, lime, smoothstep(0.2, 0.7, u) * 0.32);
  fire = mix(charcoal, fire, 0.94);
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
    // Blender heightfield preferred (0.94) when atlas ready — real bevel normals
    float height = mix(hAnalytic, hAtlas, u_useGlyphAtlas > 0.5 ? 0.94 : 0.0);
    // Height gradient → bevel normal (finite difference in field space)
    float eH = 0.0028;
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
      // Planar knife: face normal ≈ Z on plateau; Blender bevel only at lip
      float faceFlat = smoothstep(0.18, 0.78, height) * (1.0 - rimSharp);
      float gAmt = mix(0.003, 1.45, rimSharp) * (0.85 + 0.55 * u_bevel);
      N = normalize(vec3(
        g * gAmt * (1.0 - faceFlat * 0.99) - vec2(hdx, hdy) * 2.8 * (1.0 - faceFlat),
        mix(0.62, 1.0, faceFlat) + dripN.z * 0.16
      ));
    } else {
      // Round pipe elegance (ENj9B): SDF medial crest — Blender height only nudges normals
      // (flat Blender Z plateau crushed silverRatio ~0.56→0.14 via icy flood)
      float bodyT = clamp(mix(inside / 0.105, height, 0.18), 0.0, 1.0);
      float flankAmt = 1.0 - pow(bodyT, 0.48);
      float tube = mix(0.55, 5.8, flankAmt);
      vec2 hGrad = vec2(hdx, hdy) * mix(1.1, 5.5, flankAmt);
      float crestZ = mix(1.25, 0.08, flankAmt) * mix(1.0, 0.2, rimSharp);
      vec3 Ntube = normalize(vec3(
        g * tube - hGrad + dripN.xy * 0.45,
        crestZ + dripN.z * 0.28
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
        // Planar oil-slick: face UV spans softbox + charcoal voids across glyph
        : vec2(0.38, 0.28) + p * vec2(0.55, 0.62) + vec2(Rlight.x * 0.22, Rlight.y * 0.18) + vec2(ndotl * 0.08, fres * 0.05),
      0.0, 1.0
    );
    vec3 plate = texture(u_backdrop, plateUv).rgb;
    // Face: modest blur — keep softbox / void contrast (wide blur → cream flood)
    vec2 pxH = vec2(2.5 / max(u_resolution.x, 1.0), 0.0);
    vec2 pxV = vec2(0.0, 2.5 / max(u_resolution.y, 1.0));
    vec3 facePlate = texture(u_backdrop, facePlateUv).rgb * 0.4
      + texture(u_backdrop, clamp(facePlateUv + pxH, 0.0, 1.0)).rgb * 0.12
      + texture(u_backdrop, clamp(facePlateUv - pxH, 0.0, 1.0)).rgb * 0.12
      + texture(u_backdrop, clamp(facePlateUv + pxV, 0.0, 1.0)).rgb * 0.12
      + texture(u_backdrop, clamp(facePlateUv - pxV, 0.0, 1.0)).rgb * 0.12
      + texture(u_backdrop, clamp(facePlateUv + pxH * 2.0, 0.0, 1.0)).rgb * 0.06
      + texture(u_backdrop, clamp(facePlateUv - pxH * 2.0, 0.0, 1.0)).rgb * 0.06;
    // Soft contrast — wet mirror with hard softbox peaks / charcoal voids
    facePlate = vec3(
      pow(max(facePlate.r, 0.0), 1.35),
      pow(max(facePlate.g, 0.0), 1.35),
      pow(max(facePlate.b, 0.0), 1.35)
    );
    facePlate = clamp((facePlate - 0.08) * 1.65, 0.0, 1.65);
    // Hybrid photo-plate: sample concept crop projected onto glyph atlas UV
    float extA = max(u_glyphExtent, 1e-4);
    vec2 atlasUv = clamp(vec2(p.x / (2.0 * extA) + 0.5, p.y / (2.0 * extA) + 0.5), 0.0, 1.0);
    vec4 conceptS = texture(u_conceptFace, atlasUv);
    vec3 conceptChrome = conceptS.rgb;
    float conceptH = conceptS.a;
    float conceptAlive = u_useConceptFace * smoothstep(0.02, 0.12, max(conceptChrome.r, max(conceptChrome.g, conceptChrome.b)));
    if (conceptAlive > 0.01) {
      // Hybrid photo-plate dominant — concept crops carry 1c6PD/Z53Ve/ENj9B fidelity
      if (u_glyphId < 0.5) {
        float cL0 = dot(conceptChrome, vec3(0.2126, 0.7152, 0.0722));
        float cCh = max(abs(conceptChrome.r - conceptChrome.g), max(abs(conceptChrome.g - conceptChrome.b), abs(conceptChrome.r - conceptChrome.b)));
        float hasMetal = smoothstep(0.015, 0.07, max(conceptChrome.r, max(conceptChrome.g, conceptChrome.b)));
        float hasOil = smoothstep(0.08, 0.22, cCh);
        vec3 cOil = conceptChrome;
        // Cream/mint swamp → cool silver (NOT face-wide gold tan). Spare high-chroma oil puddles.
        float creamC0 = max(0.0, cOil.r - cOil.b * 0.98) + max(0.0, cOil.g * 0.88 - cOil.b);
        float mintC0 = max(0.0, cOil.g - cOil.r * 1.0) * max(0.0, cOil.g - cOil.b * 0.96);
        float swampC0 = max(creamC0 * 1.05, mintC0);
        // Near-equal silver (tiny B drop) — avoid cyan softbox AND cream R-lead
        vec3 coolSil = vec3(cL0 * 1.0, cL0 * 1.0, cL0 * 0.99);
        float oilSpare0 = smoothstep(0.14, 0.32, cCh) * (1.0 - smoothstep(0.58, 0.88, cL0));
        cOil = mix(cOil, coolSil, clamp(swampC0 * 2.8 * (1.0 - oilSpare0), 0.0, 0.96));
        // Neon mint + cyan softbox → warm silver; keep gold/lime oil only
        float neonL = max(0.0, cOil.g - cOil.r * 1.05) * max(0.0, cOil.g - cOil.b * 1.0);
        float cyanC0 = max(0.0, cOil.b - cOil.r * 0.98) * max(0.0, cOil.b - cOil.g * 0.96);
        cOil = mix(cOil, coolSil, clamp((neonL * 1.7 + cyanC0 * 2.2) * (1.0 - oilSpare0), 0.0, 0.95));
        cOil.b = min(cOil.b, max(cOil.r, cOil.g) * 0.98);
        facePlate = mix(facePlate, cOil, clamp(conceptAlive * hasMetal * (0.82 + 0.18 * hasOil), 0.0, 0.99));
        float emptyC = (1.0 - hasMetal) * (1.0 - hasOil);
        facePlate = mix(facePlate, vec3(0.38, 0.375, 0.36), emptyC * conceptAlive * 0.55);
        float creamFp = max(0.0, facePlate.r - facePlate.b * 0.98) + max(0.0, facePlate.g * 0.86 - facePlate.b);
        float mintFp = max(0.0, facePlate.g - facePlate.r * 1.0) * max(0.0, facePlate.g - facePlate.b * 0.96);
        float cyanFp = max(0.0, facePlate.b - facePlate.r * 0.98) * max(0.0, facePlate.b - facePlate.g * 0.96);
        facePlate = mix(facePlate, coolSil, clamp((creamFp * 2.0 + mintFp * 2.2 + cyanFp * 2.4) * conceptAlive * hasMetal * (1.0 - oilSpare0), 0.0, 0.97));
        facePlate.b = min(facePlate.b, max(facePlate.r, facePlate.g) * 0.98);
        conceptChrome = cOil;
      } else {
        // Tubular: concept luma → crest only; never stamp dark voids into facePlate
        float cL = dot(conceptChrome, vec3(0.2126, 0.7152, 0.0722));
        vec3 silverMap = vec3(cL * 1.02, cL * 1.0, cL * 0.96);
        float structAmt = conceptAlive * 0.28 * smoothstep(0.4, 0.88, cL);
        facePlate = mix(facePlate, silverMap, clamp(structAmt, 0.0, 0.4));
        // Raise dark concept holes to mid metal (void kill)
        float hole = (1.0 - smoothstep(0.08, 0.35, cL)) * conceptAlive;
        facePlate = mix(facePlate, vec3(0.22, 0.225, 0.24), hole * 0.85);
      }
      N = normalize(mix(N, normalize(N + vec3((conceptH - 0.5) * 1.15, (conceptH - 0.45) * 0.95, 0.0)), conceptAlive * 0.22));
    }
    if (u_glyphId < 0.5) {
      // Planar oil-slick: softbox + elliptical oil on charcoal (anti flat cream / anti neon)
      float oph = fract(dot(p, vec2(0.9, 1.55)) * 0.7 + Rlight.x * 0.2 + ndotl * 0.3);
      vec3 ofire = oilFire(oph, 0.88);
      float oL = max(dot(ofire, vec3(0.2126, 0.7152, 0.0722)), 0.2);
      float fL = max(dot(facePlate, vec3(0.2126, 0.7152, 0.0722)), 0.08);
      float ellOil = exp(-dot((p - vec2(0.02, 0.0)) * vec2(1.8, 2.4), (p - vec2(0.02, 0.0)) * vec2(1.8, 2.4)));
      ellOil = max(ellOil, 0.75 * exp(-dot((p - vec2(0.1, -0.12)) * vec2(2.0, 2.2), (p - vec2(0.1, -0.12)) * vec2(2.0, 2.2))));
      ellOil = max(ellOil, 0.55 * exp(-dot((p - vec2(-0.08, -0.1)) * vec2(2.1, 1.9), (p - vec2(-0.08, -0.1)) * vec2(2.1, 1.9))));
      float oWash = 0.45 + 0.55 * pow(0.5 + 0.5 * cos(dot(p, vec2(1.15, 1.85)) + ndotl), 0.8);
      oWash *= (0.4 + 0.6 * ellOil);
      // Charcoal floor — preserve dark softbox voids (anti flat cream-silver)
      facePlate = max(facePlate, vec3(0.05, 0.055, 0.07) * (0.55 + 0.45 * fL));
      // Midtone oil — gold/lime elliptical puddles on softbox (1c6PD/Z53Ve sparse)
      float midOil = smoothstep(0.08, 0.36, fL) * (1.0 - smoothstep(0.52, 0.85, fL));
      float synthOil = oWash * midOil * mix(0.62, 0.78, conceptAlive);
      facePlate = mix(facePlate, ofire * (max(fL, 0.3) / oL), synthOil * 0.95);
      // Crush mint/cream/cyan-milk → cool silver; spare gold/lime oil chroma
      float peakSil = smoothstep(0.48, 0.8, fL);
      float peakCh = max(facePlate.r, max(facePlate.g, facePlate.b)) - min(facePlate.r, min(facePlate.g, facePlate.b));
      float mintPeak = max(0.0, facePlate.g - facePlate.r * 1.0) * max(0.0, facePlate.g - facePlate.b * 0.96);
      float creamPeak0 = max(0.0, facePlate.r - facePlate.b * 0.98) + max(0.0, facePlate.g * 0.86 - facePlate.b);
      float cyanPeak = max(0.0, facePlate.b - facePlate.r * 0.96) * max(0.0, facePlate.b - facePlate.g * 0.92);
      float goldSpare = smoothstep(0.1, 0.28, peakCh) * step(facePlate.b + 0.04, facePlate.r) * step(facePlate.b + 0.02, facePlate.g);
      vec3 coolPush = vec3(fL * 1.0, fL * 1.0, fL * 0.99);
      facePlate = mix(facePlate, coolPush, clamp((mintPeak * 2.2 + creamPeak0 * 1.8 + cyanPeak * 2.4) * (1.0 - midOil * 0.55) * (1.0 - goldSpare), 0.0, 0.97));
      facePlate = mix(facePlate, coolPush, clamp(peakSil * step(peakCh, 0.14) * 0.72, 0.0, 0.78));
      float gFlood = max(0.0, facePlate.g - facePlate.r * 1.04) * max(0.0, facePlate.g - facePlate.b * 1.0);
      float fSil0 = dot(facePlate, vec3(0.2126, 0.7152, 0.0722));
      facePlate = mix(facePlate, vec3(fSil0 * 1.0, fSil0 * 1.0, fSil0 * 0.99), clamp(gFlood * 1.45 * (1.0 - midOil * 0.4) * (1.0 - goldSpare), 0.0, 0.9));
      facePlate.b = mix(facePlate.b, min(facePlate.b, max(facePlate.r, facePlate.g) * 0.98), 1.0 - goldSpare);
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
      float cyanWash = max(0.0, mir.b - mir.r * 0.95) * max(0.0, mir.b - mir.g * 0.94);
      float limeKeep = smoothstep(0.08, 0.28, faceChromaP) * step(mir.b + 0.02, mir.g) * step(mir.r + 0.05, mir.g);
      float goldKeep = smoothstep(0.08, 0.28, faceChromaP) * step(mir.b + 0.05, mir.r) * step(mir.b + 0.02, mir.g);
      float silverL = dot(mir, vec3(0.2126, 0.7152, 0.0722));
      mir = mix(mir, vec3(silverL * 1.0, silverL * 1.0, silverL * 0.99), clamp(cyanWash * 1.35 * (1.0 - limeKeep) * (1.0 - goldKeep), 0.0, 0.92));
      mir.b = mix(mir.b, min(mir.b, max(mir.r, mir.g) * 0.98), (1.0 - goldKeep) * (1.0 - limeKeep));
      mir *= mix(0.22, 1.45, panelAlive);
    }
    color = mix(darkBody, mir * (u_glyphId > 0.5 ? 1.45 : 1.95), mirrorAmt * faceAlive);
    if (u_glyphId < 0.5) {
      // Soft luminance voids — charcoal floor + softbox peaks (anti hollow + anti cream)
      float softPanel = mix(0.55, 1.0, smoothstep(0.04, 0.52, facePeak));
      softPanel = max(softPanel, panelAlive * 0.75);
      color = mix(darkBody + facePlate * 0.55, color, softPanel);
      // When concept plate alive, kill softbox flood entirely (oil lives on facePlate)
      float softboxGate = mix(1.0, 0.0, conceptAlive);
      color += facePlate * faceHard * 0.85 * u_glass * faceAlive * softPanel * softboxGate;
      color += plate * hardBar * 0.18 * u_glass * faceAlive * softPanel * softboxGate;
      color += vec3(1.02, 1.04, 1.06) * pow(faceHard, 2.4) * 0.28 * u_glass * faceAlive * softPanel * softboxGate;
      float cyanFace = max(0.0, color.b - color.r * 0.94);
      float pinkFace = max(0.0, color.r - color.g * 1.0) * max(0.0, color.b - color.g * 0.85);
      float limeKeep2 = step(color.b + 0.02, color.g) * step(color.r + 0.04, color.g);
      // Crush pink0 + cyan milk; spare oil lime/gold
      color = mix(color, facePlate * softPanel * 0.9, clamp((cyanFace * 0.35 + pinkFace * 1.25) * faceAlive * (1.0 - limeKeep2), 0.0, 0.65));
      color.r -= pinkFace * 1.0 * faceAlive;
      color.b -= pinkFace * 0.75 * faceAlive;
      float lavM = max(0.0, color.b - color.r * 0.98) * (1.0 - limeKeep2) * (1.0 - smoothstep(0.08, 0.22, faceChromaP));
      float sL = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color, vec3(sL * 1.0, sL * 1.0, sL * 0.99), clamp(lavM * 1.1 * faceAlive, 0.0, 0.85));
      // Prefer concept wet-mirror over softbox cream mid
      if (conceptAlive > 0.01) {
        color = mix(color, facePlate, faceAlive * conceptAlive * 0.72);
      }
      color = max(color, facePlate * 0.5 * faceAlive);
      // Charcoal floor — NOT cream-silver mid
      color = max(color, vec3(0.06, 0.065, 0.08) * faceAlive);
    } else {
      color += plate * hardBar * 0.28 * u_glass * faceAlive;
      color += facePlate * faceHard * 0.32 * u_glass * faceAlive;
      color += envFace * hardBar * 0.22 * u_glass * faceAlive;
    }
    color = max(color, darkBody * (u_glyphId > 0.5 ? 1.4 : 1.0) * faceAlive);

    if (u_glyphId > 0.5) {
      // Round tubular pipe (ENj9B): narrow crest + mid flanks (elegance, anti soft-white flood / voids)
      float tubeBody = smoothstep(0.0, max(bevelW * 0.55, 0.0012), inside);
      float hPipe = u_useGlyphAtlas > 0.5 ? glyphAtlasHeight(p) : 0.0;
      // Crest/flank for tubular elegance — silverRatio ~0.63 target vs ENj9B
      float bodyT = clamp(mix(inside / 0.088, hPipe, 0.14), 0.0, 1.0);
      float crest = pow(bodyT, 0.58);
      float flank = 1.0 - crest;
      float heightFlank = 1.0 - smoothstep(0.08, 0.58, hPipe);
      float wrapFres = pow(1.0 - ndotv, 0.92);
      float tubeCatch = pow(max(dot(N, H), 0.0), 36.0);
      float hemi = 0.16 + 0.84 * max(dot(N, L), 0.0);
      float medial = exp(-pow((bodyT - 1.0) * 3.2, 2.0)) * crest;
      float silRibbon = clamp(
        crest * hemi * 2.35 + wrapFres * 0.85 + tubeCatch * 1.35 + medial * 1.15,
        0.0, 1.0
      );
      vec3 charcoal = vec3(0.12, 0.125, 0.13);
      vec3 midMetal = vec3(0.36, 0.36, 0.35);
      // Warm silver crest only (anti face-wide ice flood)
      vec3 silverWrap = vec3(0.985, 0.98, 0.965);
      silverWrap *= (0.18 + 2.15 * crest * hemi + 1.35 * wrapFres);
      silverWrap += vec3(1.12, 1.08, 1.0) * tubeCatch * 2.4;
      if (conceptAlive > 0.01) {
        float cL = dot(conceptChrome, vec3(0.2126, 0.7152, 0.0722));
        float conceptCrest = smoothstep(0.28, 0.82, cL) * mix(0.45, 1.0, conceptH);
        silRibbon = max(silRibbon, conceptCrest * conceptAlive * 0.55);
        silverWrap = mix(silverWrap, vec3(1.0, 0.995, 0.98) * (0.35 + 1.15 * cL), conceptAlive * conceptCrest * 0.4);
        // Concept dark → soft flank shade only (never punch voids through tube body)
        float conceptFlank = (1.0 - smoothstep(0.15, 0.55, cL)) * conceptAlive;
        midMetal = mix(midMetal, midMetal * 0.88 + charcoal * 0.12, conceptFlank * flank * 0.22);
      }
      float silAmt = clamp(pow(silRibbon, 0.55) * 1.15, 0.0, 0.88);
      float cylShade = clamp(pow(crest, 1.05) * hemi * 1.4 + wrapFres * 0.42, 0.0, 1.0);
      vec3 tubeFill = mix(charcoal, midMetal, cylShade);
      tubeFill = mix(tubeFill, silverWrap, silAmt);
      // Stronger flank darken — continuous pipe (void kill without silver flood)
      tubeFill = mix(tubeFill, midMetal * 0.7 + charcoal * 0.3, max(flank, heightFlank * 0.6) * (1.0 - silAmt) * 0.55);
      float faceAmt = mix(0.995, 0.1, rimSharp) * u_glass * mix(0.97, 1.0, tubeBody);
      color = mix(midMetal * 0.9, tubeFill, faceAmt);
      color = max(color, silverWrap * silAmt * 0.85);
      color = max(color, midMetal * crest * hemi * 1.0);
      color = max(color, midMetal * tubeBody * 0.9);
      color = max(color, vec3(0.94, 0.935, 0.92) * pow(crest * hemi, 1.05) * 0.85 * faceAlive);
      if (conceptAlive > 0.01) {
        float cL2 = dot(conceptChrome, vec3(0.2126, 0.7152, 0.0722));
        float brightPush = smoothstep(0.28, 0.78, cL2) * conceptAlive;
        color = max(color, vec3(0.93, 0.925, 0.91) * brightPush * crest * 0.45);
        // Soft flank only — do not dig voids from concept dark
        float darkPush = (1.0 - smoothstep(0.18, 0.55, cL2)) * conceptAlive;
        color = mix(color, midMetal, darkPush * flank * 0.32);
      }
    } else {
      // Soft planar oil — cooler sparse puddles (anti cream/butter softbox)
      float faceIris = faceAlive * (1.0 - rimSharp * 0.12);
      float irisPhase = fract(dot(p, vec2(0.75, 1.25)) * 0.4 + ndotl * 0.5 + fres * 0.35);
      float ellIris = exp(-dot((p - vec2(-0.02, 0.04)) * vec2(1.6, 2.1), (p - vec2(-0.02, 0.04)) * vec2(1.6, 2.1)));
      ellIris = max(ellIris, 0.7 * exp(-dot((p - vec2(0.12, -0.1)) * vec2(1.9, 2.3), (p - vec2(0.12, -0.1)) * vec2(1.9, 2.3))));
      ellIris = max(ellIris, 0.55 * exp(-dot((p - vec2(-0.08, -0.14)) * vec2(2.2, 1.8), (p - vec2(-0.08, -0.14)) * vec2(2.2, 1.8))));
      ellIris = max(ellIris, 0.4 * exp(-dot((p - vec2(0.06, 0.12)) * vec2(2.0, 2.0), (p - vec2(0.06, 0.12)) * vec2(2.0, 2.0))));
      float oilWash = (0.5 + 0.5 * cos(dot(p, vec2(1.05, 1.7)) + ndotl)) * (0.3 + 0.7 * ellIris);
      float baseL = max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.12);
      float midIris = smoothstep(0.08, 0.34, baseL) * (1.0 - smoothstep(0.5, 0.8, baseL));
      vec3 irisA = oilFire(irisPhase, 0.85);
      vec3 irisB = oilFire(fract(irisPhase + 0.33), 0.7);
      vec3 oilMix = mix(irisA, irisB, clamp(oilWash, 0.0, 1.0));
      float oilL = max(dot(oilMix, vec3(0.2126, 0.7152, 0.0722)), 0.2);
      // Sparse gold/lime oil puddles (anti neon gold face flood vs 1c6PD/Z53Ve wet-mirror)
      float synthIris = faceIris * midIris * mix(0.22, 0.3, conceptAlive) * u_dispersion;
      color = mix(color, oilMix * (baseL / oilL) * 1.0, synthIris);
      color += (irisA - 0.32) * faceIris * ellIris * midIris * mix(0.1, 0.16, conceptAlive) * u_dispersion * u_glass;
      color += (irisB - 0.32) * faceIris * oilWash * midIris * mix(0.06, 0.1, conceptAlive) * u_dispersion * u_glass;
      // Softbox peaks stay warm-neutral — crush mint + cyan softbox on hot faces
      float mintFace = max(0.0, color.g - color.r * 1.0) * max(0.0, color.g - color.b * 0.96);
      float cyanFace2 = max(0.0, color.b - color.r * 0.96) * max(0.0, color.b - color.g * 0.92);
      float peakFace = smoothstep(0.5, 0.8, baseL);
      float goldKeepI = smoothstep(0.1, 0.26, max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b))))
        * step(color.b + 0.04, color.r) * step(color.b + 0.02, color.g);
      color = mix(color, vec3(baseL * 1.0, baseL * 1.0, baseL * 0.99), clamp((mintFace * 2.0 + cyanFace2 * 2.2) * peakFace * (1.0 - midIris) * (1.0 - goldKeepI), 0.0, 0.94));
      float softGlint = pow(max(faceHard, 0.25), 1.5) * faceAlive * mix(1.0, 0.12, conceptAlive);
      color += vec3(1.0, 0.99, 0.96) * softGlint * 0.18 * u_glass;
      color = max(color, facePlate * mix(0.45, 0.75, conceptAlive) * faceAlive);
      color = max(color, vec3(0.07, 0.075, 0.09) * faceAlive * (1.0 - rimSharp * 0.5));
      // Extra cream/mint/cyan crush after soft planar iris → warm silver (spare gold oil)
      float creamIris = max(0.0, color.r - color.b * 0.98) + max(0.0, color.g * 0.86 - color.b);
      float mintIris = max(0.0, color.g - color.r * 1.0) * max(0.0, color.g - color.b * 0.96);
      float cyanIris = max(0.0, color.b - color.r * 0.96) * max(0.0, color.b - color.g * 0.9);
      float bL = max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.1);
      color = mix(color, vec3(bL * 1.0, bL * 1.0, bL * 0.99), clamp((creamIris * 1.9 + mintIris * 2.2 + cyanIris * 2.4) * faceAlive * (1.0 - goldKeepI), 0.0, 0.96));
      color.b = mix(color.b, min(color.b, max(color.r, color.g) * 0.98), (1.0 - goldKeepI) * faceAlive);
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
      float tubeAlive = smoothstep(0.0, max(bevelW * 0.55, 0.0012), inside);
      float hPipe2 = u_useGlyphAtlas > 0.5 ? glyphAtlasHeight(p) : 0.0;
      float bodyT2 = clamp(mix(inside / 0.1, hPipe2, 0.14), 0.0, 1.0);
      float crest2 = pow(bodyT2, 0.56);
      float flank2 = 1.0 - crest2;
      float heightFlank2 = 1.0 - smoothstep(0.08, 0.62, hPipe2);
      float wrapFres2 = pow(1.0 - ndotv, 0.88);
      float hemiPost = 0.18 + 0.82 * max(dot(N, L), 0.0);
      float medial2 = exp(-pow((bodyT2 - 1.0) * 2.9, 2.0)) * crest2 * 0.85;
      // Warm crest adds (anti icy B spine)
      color += vec3(0.97, 0.965, 0.94) * wrapFres2 * faceAlive * 0.78 * u_glass;
      color += vec3(0.99, 0.985, 0.955) * crest2 * hemiPost * 1.35 * u_glass * faceAlive;
      color += vec3(0.97, 0.962, 0.94) * medial2 * 1.45 * u_glass;
      // Soft flank — raise floor (void kill) without ice flood
      color = mix(color, vec3(0.22, 0.225, 0.23), flank2 * 0.28 * tubeAlive * (1.0 - crest2 * hemiPost));
      color = max(color, vec3(0.2, 0.205, 0.21) * tubeAlive * u_glass);
      color = max(color, vec3(0.32, 0.32, 0.315) * crest2 * hemiPost * tubeAlive);
      color = max(color, envFace * vec3(0.38, 0.39, 0.4) * 0.18 * tubeAlive * u_glass);
      float flatW = smoothstep(0.55, 1.15, dot(color, vec3(0.2126, 0.7152, 0.0722)));
      float chromaW = max(abs(color.r - color.g), abs(color.g - color.b));
      float silSpare = clamp(wrapFres2 * 1.05 + crest2 * hemiPost * 1.9 + medial2 * 1.7 + pow(max(dot(N, H), 0.0), 24.0) * 1.4, 0.0, 1.0);
      color = mix(
        color,
        vec3(0.18, 0.185, 0.19) + vec3(0.22, 0.22, 0.215) * wrapFres2,
        flatW * (1.0 - smoothstep(0.03, 0.12, chromaW)) * (1.0 - silSpare * 0.97) * 0.4 * tubeAlive
      );
      float icyTint = max(0.0, color.b - color.r * 0.97);
      float silL = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color, vec3(silL * 1.01, silL * 1.0, silL * 0.97), clamp(icyTint * 1.05 * tubeAlive * max(flank2, heightFlank2 * 0.5), 0.0, 0.78));
    }

    float specRim = mix(u_glyphId < 0.5 ? max(0.25, streakShoulder) : 0.06, 1.0, rimSharp);
    // Soft warm-neutral glints on chrome (anti cyan softbox); lime/gold accents on script
    if (u_glyphId < 0.5) {
      color += vec3(1.08, 1.05, 0.95) * exp(-dot((e - vec2(0.1, 0.15)) * vec2(4.0, 2.5), (e - vec2(0.1, 0.15)) * vec2(4.0, 2.5))) * 0.28 * specRim;
      color += vec3(1.05, 1.04, 0.98) * exp(-dot((e + vec2(0.05, -0.1)) * vec2(3.8, 2.8), (e + vec2(0.05, -0.1)) * vec2(3.8, 2.8))) * 0.24 * specRim;
    } else {
      color += vec3(0.85, 1.05, 0.7) * exp(-dot((e - vec2(0.1, 0.15)) * vec2(4.0, 2.5), (e - vec2(0.1, 0.15)) * vec2(4.0, 2.5))) * 0.22 * specRim;
      color += vec3(1.05, 0.98, 0.55) * exp(-dot((e + vec2(0.05, -0.1)) * vec2(3.8, 2.8), (e + vec2(0.05, -0.1)) * vec2(3.8, 2.8))) * 0.24 * specRim;
      color += vec3(1.1, 1.15, 0.55) * exp(-pow((e.y - 0.2) * 4.5, 2.0)) * 0.2 * mix(0.1, 1.0, rimSharp);
    }

    color = max(color, vec3(0.0));
    // Contrast expand — charcoal voids + softbox peaks (not cream mid floor)
    if (u_glyphId < 0.5) {
      float cl = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color * 0.35, color * 1.45, smoothstep(0.06, 1.35, cl));
      float cream = max(0.0, color.r - color.b * 1.05);
      cream = max(cream, max(0.0, color.g * 0.85 - color.b));
      cream = max(cream, max(0.0, color.r - color.g * 0.9) * 0.6);
      float creamL = smoothstep(0.35, 1.25, cl) * faceAlive;
      float oilSpare = smoothstep(0.1, 0.28, max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b))));
      float cSil = dot(color, vec3(0.2126, 0.7152, 0.0722));
      // Hard cream → near-equal silver / concept oil (anti pastel + anti cyan B-boost)
      color = mix(color, vec3(cSil * 1.0, cSil * 1.0, cSil * 0.99), clamp(cream * 3.2 * creamL * (1.0 - oilSpare * 0.35), 0.0, 0.88));
      color.r -= cream * 0.75 * creamL * (1.0 - oilSpare * 0.3);
      color.g -= cream * 0.55 * creamL * (1.0 - oilSpare * 0.3);
      // Neon lime only — spare mid oil; crush pastel mint softbox → cool silver
      float limeMid = max(0.0, color.g - color.r * 1.04) * max(0.0, color.g - color.b * 1.0);
      float sMid = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color, vec3(sMid * 1.0, sMid * 1.0, sMid * 0.99), clamp(limeMid * 1.4 * faceAlive, 0.0, 0.85));
      // Re-assert concept mid oil after cream crush (high-chroma only; cream→cool silver)
      if (conceptAlive > 0.01) {
        float cLx = dot(conceptChrome, vec3(0.2126, 0.7152, 0.0722));
        float cChx = max(abs(conceptChrome.r - conceptChrome.g), max(abs(conceptChrome.g - conceptChrome.b), abs(conceptChrome.r - conceptChrome.b)));
        float midX = smoothstep(0.08, 0.32, cLx) * (1.0 - smoothstep(0.55, 0.85, cLx));
        float creamX = max(0.0, conceptChrome.r - conceptChrome.b * 0.98) + max(0.0, conceptChrome.g * 0.88 - conceptChrome.b);
        float mintX = max(0.0, conceptChrome.g - conceptChrome.r * 1.0) * max(0.0, conceptChrome.g - conceptChrome.b * 0.96);
        vec3 coolX = vec3(cLx * 1.0, cLx * 1.0, cLx * 0.99);
        float spareX = smoothstep(0.14, 0.3, cChx);
        vec3 cWet = mix(conceptChrome, coolX, clamp((creamX * 2.0 + mintX * 2.2) * (1.0 - spareX), 0.0, 0.95));
        color = mix(color, cWet, clamp(midX * conceptAlive * 0.55, 0.0, 0.7));
      }
      color = max(color, vec3(0.045, 0.05, 0.065) * faceAlive);
    }

    vec2 T = normalize(vec2(-g.y, g.x) + 1e-5);
    float aniso = pow(max(1.0 - abs(dot(normalize(R.xy + 1e-5), T)), 0.0), 3.8);
    float anisoAmt = u_glyphId > 0.5 ? (0.32 + 0.5 * rimSharp) : (0.0 + 0.1 * rimSharp);
    color += env * aniso * anisoAmt;

    if (u_glyphId > 0.5) {
      float spine = exp(-pow(inside / 0.055, 2.0) * 0.28) * (1.0 - rimSharp * 0.1);
      float wrapFresS = pow(1.0 - ndotv, 0.92);
      float tubeAliveS = smoothstep(0.0, max(bevelW * 0.55, 0.0012), inside);
      // Warm spine (anti icy B residual)
      color += vec3(1.0, 0.995, 0.97) * spine * wrapFresS * 2.4 * u_glass;
      color += envFace * spine * vec3(0.95, 0.94, 0.9) * 0.7;
      color = max(color, vec3(0.22, 0.225, 0.24) * tubeAliveS * u_glass);
      color = max(color, ambTint * 0.65 * tubeAliveS * u_glass);
      float joinZone = exp(-pow(length(p - vec2(-0.08, 0.05)) / 0.26, 2.0));
      joinZone = max(joinZone, exp(-pow(length(p - vec2(-0.12, 0.1)) / 0.2, 2.0)));
      joinZone = max(joinZone, exp(-pow(length(p - vec2(-0.14, 0.0)) / 0.18, 2.0)));
      color += vec3(0.98, 0.975, 0.95) * joinZone * wrapFresS * tubeAliveS * 2.05 * u_glass;
      color = max(color, envFace * joinZone * 1.15 * tubeAliveS * u_glass);
      color = max(color, vec3(0.3, 0.3, 0.292) * joinZone * tubeAliveS);
      color = max(color, vec3(0.4, 0.4, 0.39) * joinZone * 1.35 * tubeAliveS);
    }

    vec3 rimCol = mix(vec3(1.22, 1.2, 1.12), envRim * 2.4, 0.7);
    color = mix(color, max(color, rimCol), rimSharp * (u_glyphId > 0.5 ? 0.55 : 0.4) * (0.7 + 0.25 * fres));

    if (u_glyphId > 0.5) {
      color = mix(color, color * vec3(1.0, 0.995, 0.97), mix(0.04, 0.18, rimSharp));
    } else {
      color = mix(color, max(color, rimCol * vec3(1.0, 0.98, 0.94)), rimSharp * 0.28);
      color = mix(color, color * vec3(1.0, 0.98, 0.96), rimSharp * 0.12);
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
    if (u_glyphId < 0.5) fireAmt *= mix(0.02, 0.22, rimSharp); // rim whisper only; face via softbox
    float fireBand = pow(rim, 0.8) * mix(0.8, 1.45, rimSharp);
    float fireT = fract(ndotl * 2.5 + fres * 0.95 + length(p) * 1.25 + rimSharp * 0.48);
    float lightSide = smoothstep(-0.16, 0.92, ndotl);
    // Chrome: cool silver rim fire (kill residual lime/gold rim glow); script: cyan/lime/gold
    vec3 fireA = edgeFire(mix(0.9, 0.1, lightSide), fireAmt * fireBand * (u_glyphId < 0.5 ? 0.45 : 1.0));
    vec3 fireB = edgeFire(mix(0.16, 0.8, lightSide), fireAmt * fireBand * 0.75 * max(lightDisp, 0.48));
    if (u_glyphId < 0.5) {
      fireA = vec3(0.95, 1.0, 1.08) * length(fireA) * 0.55;
      fireB = vec3(0.92, 0.98, 1.06) * length(fireB) * 0.5;
    } else {
      fireA *= vec3(0.75, 0.95, 1.05);
      fireB *= vec3(0.7, 0.98, 1.08);
    }
    color += fireA * (u_glyphId < 0.5 ? mix(0.04, 0.35, rimSharp) : 0.4);
    color += fireB * (u_glyphId < 0.5 ? mix(0.03, 0.28, rimSharp) : 0.35);
    if (u_glyphId > 0.5) {
      color += edgeFire(fireT, fireAmt * edge * 0.28) * vec3(0.75, 0.95, 1.05);
    } else {
      color += vec3(0.9, 0.95, 1.05) * fireAmt * edge * 0.12 * rimSharp;
    }
    float outerFire = smoothstep(bevelW * 2.9, -aa * 0.6, d) * (1.0 - smoothstep(-aa, bevelW * 0.9, -d));
    color += (u_glyphId < 0.5
      ? vec3(0.85, 0.92, 1.05) * outerFire * u_dispersion * 0.12 * u_lightIntensity
      : edgeFire(0.28 + 0.45 * lightSide, outerFire * u_dispersion * 0.5 * u_lightIntensity) * vec3(0.75, 0.95, 1.05));
    float halo = smoothstep(bevelW * 1.55, 0.0, inside) * (1.0 - rimSharp * 0.3);
    color += (u_glyphId < 0.5
      ? vec3(0.88, 0.94, 1.05) * halo * u_dispersion * 0.08 * rimSharp
      : edgeFire(mix(0.18, 0.82, lightSide), halo * u_dispersion * 0.22 * (0.5 + 0.5 * lightDisp)) * vec3(0.7, 0.95, 1.05) * 0.35);

    float film = u_filmThickness;
    if (film > 0.001) {
      float faceFilm = u_glyphId > 0.5
        ? faceGate * 0.18
        : faceGate * mix(0.7, 1.15, clamp(faceHard, 0.0, 1.0));
      float thick = film * (0.45 + 0.4 * rimSharp + 0.7 * faceFilm);
      float filmStr = film * mix(0.45, 0.95, rimSharp) * (0.45 + 0.55 * ndotl);
      if (u_glyphId < 0.5) filmStr *= mix(0.45, 0.92, clamp(faceHard, 0.0, 1.0) * (1.0 - smoothstep(0.58, 0.92, facePeak)));
      vec3 filmTint = thinFilm(thick, ndotv, ndotl, filmStr);
      // Pink0 + cyan-milk crush; spare mid oil cyan/lime/gold accents
      float fPink = max(0.0, filmTint.r - filmTint.g * 1.02) * max(0.0, filmTint.b - filmTint.g * 0.9);
      filmTint.r -= fPink * 0.9;
      filmTint.b -= fPink * 0.7;
      float fChroma = max(abs(filmTint.r - filmTint.g), max(abs(filmTint.g - filmTint.b), abs(filmTint.r - filmTint.b)));
      float fLimeNeon = max(0.0, filmTint.g - filmTint.r * 1.12) * max(0.0, filmTint.g - filmTint.b * 1.1);
      float fCyanMilk = max(0.0, filmTint.b - filmTint.r * 0.95) * (1.0 - smoothstep(0.1, 0.28, fChroma));
      float fSil = dot(filmTint, vec3(0.2126, 0.7152, 0.0722));
      filmTint = mix(filmTint, vec3(fSil * 1.0, fSil * 1.0, fSil * 0.99), clamp(fCyanMilk * 1.1 + fLimeNeon * 0.45 * smoothstep(0.55, 0.88, facePeak), 0.0, 0.7));
      color += (filmTint - 0.5) * filmStr * mix(0.95, 1.35, rimSharp) * (u_glyphId < 0.5 ? 1.05 : 0.55);
      color = mix(color, color * filmTint, film * faceFilm * (u_glyphId < 0.5 ? 0.38 : 0.12));
    }

    if (p.y < -0.02) {
      float dripZone = smoothstep(-0.01, -0.48, p.y);
      vec3 dripEnv = studioEnv(normalize(Rface + vec3(0.0, -0.4, 0.12)));
      float dripMix = u_glyphId > 0.5 ? 0.32 : 0.35;
      color = mix(color, max(color, dripEnv * (u_glyphId > 0.5 ? vec3(1.05, 1.04, 0.98) : vec3(1.02, 1.02, 1.0))), dripZone * (dripMix + 0.15 * rimSharp));
      color += vec3(1.1, 1.08, 1.02) * specStar * dripZone * (u_glyphId > 0.5 ? 1.4 : 1.6) * li;
      // Chrome: warm silver drip — kill cream + cyan softbox; script: warm tube tip
      if (u_glyphId < 0.5) {
        color += edgeFire(0.55 + 0.25 * ndotl, dripZone * u_dispersion * 0.12) * vec3(1.0, 0.85, 0.45) * rimSharp;
      } else {
        float dripTube = smoothstep(0.0, max(bevelW * 0.55, 0.0012), inside);
        color += edgeFire(0.55 + 0.25 * ndotl, dripZone * u_dispersion * 0.18) * vec3(1.0, 0.98, 0.9);
        color = max(color, vec3(0.62, 0.615, 0.58) * dripZone * dripTube);
      }
      float dripFloor = u_glyphId > 0.5 ? 2.0 : 1.45;
      color = max(color, darkBody * dripFloor * dripZone * (1.0 - rimSharp * 0.35));
      if (u_glyphId > 0.5) {
        float dripTube2 = smoothstep(0.0, max(bevelW * 0.55, 0.0012), inside);
        color = max(color, ambTint * 0.55 * dripZone * (1.0 - rimSharp * 0.3));
        color = max(color, vec3(0.42, 0.42, 0.4) * dripZone * dripTube2 * u_glass);
        float junc = smoothstep(-0.05, -0.2, p.y) * smoothstep(-0.58, -0.28, p.y);
        float juncFres = pow(1.0 - ndotv, 1.25);
        color = max(color, vec3(0.55, 0.545, 0.52) * junc * dripTube2 * u_glass);
        color = max(color, envFace * junc * 0.75 * u_glass);
        color += vec3(0.95, 0.94, 0.9) * junc * juncFres * 1.1 * u_glass;
      } else {
        // Cream drip-bulb (1c6PD/Z53Ve) — localized tip; planar face stays wet-mirror
        float bulb = smoothstep(-0.22, -0.58, p.y);
        float bulbCore = pow(smoothstep(-0.28, -0.65, p.y), 1.25);
        vec3 creamBulb = vec3(0.9, 0.86, 0.7);
        vec3 darkBulb = vec3(0.08, 0.09, 0.11);
        float bulbShade = clamp((-p.y - 0.32) / 0.4, 0.0, 1.0);
        vec3 bulbCol = mix(creamBulb, darkBulb, bulbShade * 0.78);
        color = mix(color, bulbCol, bulbCore * 0.58 * u_glass);
        color = max(color, creamBulb * bulbCore * 0.42 * (1.0 - bulbShade * 0.7));
        color = max(color, facePlate * vec3(1.02, 1.0, 0.92) * dripZone * 0.45 * u_glass);
        color = max(color, vec3(0.08, 0.09, 0.11) * dripZone * u_glass);
        // Kill cyan on drip only — spare cream R-lead on bulb
        float tipCyanD = max(0.0, color.b - color.r * 0.97);
        float dSil0 = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(color, vec3(dSil0 * 1.02, dSil0 * 1.0, dSil0 * 0.96), clamp(tipCyanD * 1.8 * dripZone, 0.0, 0.9));
        float limeLip = max(0.0, color.g - color.r * 1.12) * max(0.0, color.g - color.b * 1.05);
        color = mix(color, vec3(dSil0 * 1.02, dSil0 * 1.0, dSil0 * 0.96), clamp(limeLip * 0.55 * dripZone * (1.0 - bulbCore), 0.0, 0.45));
      }
      color += vec3(1.1, 1.12, 1.2) * envStar * dripZone * 1.1 * li;
    }

    color = mix(color, color + refracted * 0.18, rimSharp * 0.14 * u_glass);

    // Soft tone-map — script silver unequal (capture strips equal RGB≥248)
    float peak = max(color.r, max(color.g, color.b));
    color = color / (1.0 + peak * (u_glyphId > 0.5 ? 0.08 : 0.12));
    if (u_glyphId > 0.5) {
      // Round pipe chrome (ENj9B) — narrow crest + mid flanks (tubular elegance, anti soft-white flood / voids)
      float tubeAliveF = smoothstep(0.0, max(bevelW * 0.55, 0.0012), inside);
      float hFin = u_useGlyphAtlas > 0.5 ? glyphAtlasHeight(p) : 0.0;
      float bodyTF = clamp(mix(inside / 0.088, hFin, 0.14), 0.0, 1.0);
      float crestFin = pow(bodyTF, 0.58);
      float flankFin = 1.0 - crestFin;
      float heightFlankF = 1.0 - smoothstep(0.08, 0.58, hFin);
      float hemiFin = 0.16 + 0.84 * max(dot(N, L), 0.0);
      float wrapFresF = pow(1.0 - ndotv, 0.92);
      float silField = crestFin * hemiFin * 2.2 + wrapFresF * 0.75 + pow(max(dot(N, H), 0.0), 28.0) * 1.2;
      // Crest-led silver only — mid flanks continuous (anti void / anti face-wide ice)
      float silCover = pow(smoothstep(0.12, 0.55, silField), 0.68) * mix(0.42, 1.0, crestFin);
      silCover = max(silCover, tubeAliveF * mix(0.25, 0.62, crestFin));
      vec3 charcoal = vec3(0.12, 0.125, 0.13);
      vec3 midMetal = vec3(0.38, 0.38, 0.37);
      vec3 silverFil = vec3(0.98, 0.975, 0.955);
      float cylShade = clamp(pow(crestFin, 1.0) * hemiFin * 1.4 + wrapFresF * 0.45, 0.0, 1.0);
      cylShade = max(cylShade, tubeAliveF * 0.5);
      color = mix(charcoal, midMetal, cylShade);
      color = mix(color, silverFil, silCover);
      color = mix(color, midMetal * 0.88, flankFin * (1.0 - silCover) * 0.42);
      color = mix(color, midMetal * 0.75 + charcoal * 0.25, heightFlankF * flankFin * 0.28 * (1.0 - silCover));
      if (conceptAlive > 0.01) {
        float cLf = dot(conceptChrome, vec3(0.2126, 0.7152, 0.0722));
        float conceptCover = smoothstep(0.28, 0.78, cLf) * mix(0.45, 1.0, conceptH) * conceptAlive;
        silCover = max(silCover, conceptCover * 0.55);
        color = mix(color, silverFil * (0.65 + 0.35 * cLf), conceptCover * 0.38 * crestFin);
        // Soft flank only — raise concept-dark holes to mid metal (void kill, not ice flood)
        float conceptDark = (1.0 - smoothstep(0.18, 0.58, cLf)) * conceptAlive;
        color = mix(color, midMetal, conceptDark * 0.85);
      }
      float crestCore = smoothstep(0.22, 0.65, crestFin * hemiFin) * tubeAliveF;
      color = max(color, silverFil * crestCore * 1.05);
      color = max(color, silverFil * smoothstep(0.3, 0.82, silCover) * 0.88);
      color = max(color, midMetal * tubeAliveF * 1.12);
      color = max(color, vec3(0.32, 0.32, 0.31) * tubeAliveF);
      // Hard void kill: raised mid ink floor (continuous pipe vs ENj9B)
      float inkFloor = smoothstep(0.0, max(bevelW * 0.25, 0.001), inside);
      color = max(color, vec3(0.44, 0.44, 0.43) * inkFloor);
      float holeKill = (1.0 - smoothstep(0.16, 0.42, max(color.r, max(color.g, color.b)))) * tubeAliveF;
      color = mix(color, midMetal * 1.2, clamp(holeKill * 0.99, 0.0, 0.99));
      color = max(color, midMetal * tubeAliveF * 1.25);
      color = max(color, vec3(0.44, 0.44, 0.43) * tubeAliveF);
      // Second-pass void kill — no near-black islands inside tube body
      float stillHole = (1.0 - smoothstep(0.28, 0.52, max(color.r, max(color.g, color.b)))) * tubeAliveF;
      color = mix(color, vec3(0.5, 0.5, 0.485), clamp(stillHole * 0.99, 0.0, 0.99));
      color = max(color, vec3(0.46, 0.46, 0.45) * tubeAliveF);
      // Crush soft-white flood on flanks
      float pkS = max(color.r, max(color.g, color.b));
      float chS = max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b)));
      float icyFlood = smoothstep(0.88, 0.98, pkS) * (1.0 - smoothstep(0.02, 0.1, chS)) * flankFin * (1.0 - crestCore);
      color = mix(color, midMetal * 0.9 + charcoal * 0.1, clamp(icyFlood * 0.72, 0.0, 0.75));
      color = max(color, midMetal * crestFin * hemiFin * 0.95);
      color = max(color, vec3(0.2, 0.205, 0.21) * (0.45 + 0.55 * cylShade));
      color = max(color, vec3(0.18, 0.185, 0.19) * tubeAliveF);
      float pk = max(color.r, max(color.g, color.b));
      float chroma = max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b)));
      float icy = smoothstep(0.92, 0.995, pk) * (1.0 - smoothstep(0.03, 0.12, chroma));
      icy *= (1.0 - silCover * 0.9) * flankFin;
      color = mix(color, midMetal * 0.8, clamp(icy * 0.55, 0.0, 0.6));
      float icyB = max(0.0, color.b - color.r * 0.98);
      float sL = (color.r + color.g + color.b) / 3.0;
      color = mix(color, vec3(sL * 1.01, sL * 1.0, sL * 0.97), clamp(icyB * 1.1 * flankFin, 0.0, 0.82));
      color = clamp(color, 0.0, 0.99);
      float pinkBleed = max(0.0, color.r - color.g * 1.05) * max(0.0, color.b - color.g * 0.9);
      color.r -= pinkBleed * 0.95;
      color.b -= pinkBleed * 0.65;
      float creamBleed = max(0.0, color.r - color.b * 1.02);
      color.r -= creamBleed * 0.7;
      color.g -= creamBleed * 0.35;
      // Tip/drip fill — continuous mid→silver to tip (anti dark tip lag); flanks stay mid
      float tipZone = smoothstep(-0.02, -0.52, p.y);
      color = max(color, midMetal * tipZone * tubeAliveF * 1.2);
      color = max(color, silverFil * tipZone * tubeAliveF * mix(0.35, 0.75, crestFin));
      color = mix(color, silverFil * 0.55 + midMetal * 0.45, tipZone * tubeAliveF * mix(0.28, 0.55, silCover));
      float juncFill = exp(-pow(length(p - vec2(-0.08, 0.04)) / 0.26, 2.0));
      juncFill = max(juncFill, exp(-pow(length(p - vec2(-0.12, 0.1)) / 0.22, 2.0)));
      juncFill = max(juncFill, exp(-pow(length(p - vec2(-0.14, -0.02)) / 0.2, 2.0)));
      juncFill = max(juncFill, exp(-pow(length(p - vec2(-0.06, 0.12)) / 0.2, 2.0)));
      juncFill = max(juncFill, exp(-pow(length(p - vec2(-0.1, -0.06)) / 0.2, 2.0)));
      color = max(color, midMetal * juncFill * 1.75 * tubeAliveF);
      color = max(color, silverFil * silCover * juncFill * 0.85);
      color = max(color, vec3(0.28, 0.285, 0.29) * tubeAliveF);
      color = max(color, vec3(0.24, 0.245, 0.25) * tubeAliveF);
    } else {
      // Continuous planar oil-slick — concept photo-plate first (1c6PD/Z53Ve)
      float ellA = exp(-dot((p - vec2(-0.04, 0.06)) * vec2(1.5, 2.0), (p - vec2(-0.04, 0.06)) * vec2(1.5, 2.0)));
      float ellB = exp(-dot((p - vec2(0.1, -0.08)) * vec2(1.7, 1.9), (p - vec2(0.1, -0.08)) * vec2(1.7, 1.9)));
      float ellC = exp(-dot((p - vec2(0.02, -0.18)) * vec2(2.0, 1.6), (p - vec2(0.02, -0.18)) * vec2(2.0, 1.6)));
      float ellD = exp(-dot((p - vec2(-0.1, -0.06)) * vec2(1.8, 2.2), (p - vec2(-0.1, -0.06)) * vec2(1.8, 2.2)));
      float ellE = exp(-dot((p - vec2(0.08, 0.1)) * vec2(1.9, 2.1), (p - vec2(0.08, 0.1)) * vec2(1.9, 2.1)));
      float softFace = clamp(0.35 + 0.65 * (ellA * 0.85 + ellB * 0.7 + ellC * 0.55 + ellD * 0.5 + ellE * 0.4 + faceHard * 0.65), 0.0, 1.0);
      vec3 planar = max(facePlate, vec3(0.04, 0.045, 0.055));
      // When concept plate alive, use it as the planar wet-mirror (not cream softbox ramp)
      if (conceptAlive > 0.01) {
        float cL3 = dot(conceptChrome, vec3(0.2126, 0.7152, 0.0722));
        float cCh3 = max(abs(conceptChrome.r - conceptChrome.g), max(abs(conceptChrome.g - conceptChrome.b), abs(conceptChrome.r - conceptChrome.b)));
        float hasM = smoothstep(0.015, 0.07, max(conceptChrome.r, max(conceptChrome.g, conceptChrome.b)));
        // Pre-crush concept cream/mint → cool silver; keep high-chroma oil puddles
        float creamPre = max(0.0, conceptChrome.r - conceptChrome.b * 0.98) + max(0.0, conceptChrome.g * 0.88 - conceptChrome.b);
        float mintPre = max(0.0, conceptChrome.g - conceptChrome.r * 1.0) * max(0.0, conceptChrome.g - conceptChrome.b * 0.96);
        vec3 coolPre = vec3(cL3 * 1.0, cL3 * 1.0, cL3 * 0.99);
        float sparePre = smoothstep(0.14, 0.3, cCh3) * (1.0 - smoothstep(0.58, 0.88, cL3));
        float cyanPre = max(0.0, conceptChrome.b - conceptChrome.r * 0.98) * max(0.0, conceptChrome.b - conceptChrome.g * 0.96);
        vec3 conceptWet = mix(conceptChrome, coolPre, clamp((creamPre * 2.2 + mintPre * 2.5 + cyanPre * 2.6) * (1.0 - sparePre), 0.0, 0.97));
        conceptWet.b = min(conceptWet.b, max(conceptWet.r, conceptWet.g) * 0.98);
        planar = mix(planar, conceptWet, clamp(conceptAlive * hasM * 0.97, 0.0, 0.99));
        float hotC = clamp(pow(faceHard, 2.0) * 0.55, 0.0, 1.0);
        planar = mix(planar, vec3(1.0, 0.99, 0.96) * max(cL3, 0.55), hotC * (1.0 - smoothstep(0.1, 0.26, cCh3)) * 0.3);
        // Soft mid fill for empty concept holes — avoid jagged stem charcoal voids
        planar = mix(planar, vec3(0.42, 0.415, 0.4), (1.0 - hasM) * conceptAlive * 0.55);
        color = mix(color, planar, faceAlive * softFace * 0.92);
        color = max(color, planar * faceAlive * 0.6);
        float midC = smoothstep(0.04, 0.55, cL3) * (1.0 - smoothstep(0.7, 0.92, cL3));
        color = mix(color, conceptWet, faceAlive * conceptAlive * midC * 0.55);
        color = max(color, conceptWet * faceAlive * conceptAlive * hasM * 0.4);
        float creamC = max(0.0, color.r - color.b * 0.98) + max(0.0, color.g * 0.86 - color.b);
        float mintC = max(0.0, color.g - color.r * 1.0) * max(0.0, color.g - color.b * 0.96);
        float cyanC = max(0.0, color.b - color.r * 0.98) * max(0.0, color.b - color.g * 0.96);
        float oilSpareC = smoothstep(0.12, 0.28, cCh3) * step(conceptChrome.b + 0.03, conceptChrome.r);
        float cSil = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(color, vec3(cSil * 1.0, cSil * 1.0, cSil * 0.99), clamp((creamC * 2.0 + mintC * 2.2 + cyanC * 2.5) * (1.0 - oilSpareC) * conceptAlive, 0.0, 0.97));
        color.b = min(color.b, max(color.r, color.g) * 0.98);
        // Sparse gold oil puddles from concept high-chroma only
        color = mix(color, conceptWet, faceAlive * conceptAlive * oilSpareC * midC * 0.4);
      } else {
        planar = planar * vec3(0.97, 1.0, 1.03);
        float hot = clamp(pow(faceHard, 1.65) * 1.45 + ellA * 0.25 + ndotl * 0.1, 0.0, 1.0);
        planar = mix(planar * 0.06, planar * 1.95, hot);
        float voidGate = (1.0 - hot) * (1.0 - smoothstep(0.18, 0.62, facePeak));
        planar = mix(planar, vec3(0.035, 0.04, 0.05), clamp(voidGate * 0.8, 0.0, 0.8));
        float oilPhase = fract(dot(p, vec2(0.7, 1.35)) * 0.5 + facePeak * 0.35 + ndotl * 0.3);
        float oilWash = (0.4 + 0.55 * pow(0.5 + 0.5 * cos(dot(p, vec2(1.1, 1.75)) + ndotl * 0.8), 0.8));
        oilWash *= clamp(ellA * 0.9 + ellB * 0.8 + ellC * 0.6 + ellD * 0.65 + ellE * 0.45, 0.0, 1.0);
        float panL = max(dot(planar, vec3(0.2126, 0.7152, 0.0722)), 0.08);
        float midHot = smoothstep(0.08, 0.34, panL) * (1.0 - smoothstep(0.5, 0.8, hot));
        vec3 oilA = oilFire(oilPhase, 0.95);
        vec3 oilB = oilFire(fract(oilPhase + 0.37), 0.8);
        vec3 oilTint = mix(oilA, oilB, oilWash);
        float oilL = max(dot(oilTint, vec3(0.2126, 0.7152, 0.0722)), 0.2);
        planar = mix(planar, oilTint * (panL / oilL), oilWash * midHot * 0.62 * faceAlive);
        color = mix(color, planar, faceAlive * softFace * 0.78);
        color = max(color, planar * faceAlive * 0.32);
      }
      color = max(color, vec3(0.035, 0.04, 0.05) * faceAlive);
      float vign = smoothstep(0.75, 0.25, length(p * vec2(1.15, 1.0)));
      color = mix(facePlate * 0.25, color, mix(0.65, 1.0, vign));
      // Sparse softbox glint only
      color += vec3(1.08, 1.05, 0.98) * pow(faceHard, 2.2) * faceAlive * 0.35 * u_glass * (1.0 - conceptAlive * 0.7);
      float boundary = smoothstep(0.06, 0.32, facePeak) * (1.0 - smoothstep(0.42, 0.75, facePeak));
      float oilPhaseF = fract(dot(p, vec2(0.7, 1.35)) * 0.5 + facePeak * 0.35 + ndotl * 0.3);
      vec3 oilAF = oilFire(oilPhaseF, 0.95);
      vec3 oilBF = oilFire(fract(oilPhaseF + 0.37), 0.8);
      float midHotF = smoothstep(0.08, 0.36, facePeak) * (1.0 - smoothstep(0.55, 0.88, faceHard));
      float oilWashF = clamp(ellA * 0.9 + ellB * 0.8 + ellC * 0.55, 0.0, 1.0);
      // Sparse gold oil with concept plate (anti neon gold flood)
      float synthAmt = mix(0.42, 0.28, conceptAlive);
      color += oilAF * faceAlive * boundary * 0.28 * u_dispersion * synthAmt;
      color += oilBF * faceAlive * boundary * 0.2 * u_dispersion * ellB * synthAmt;
      color += oilAF * faceAlive * midHotF * oilWashF * 0.16 * u_dispersion * synthAmt;
      float pinkF = max(0.0, color.r - color.g * 0.98) * max(0.0, color.b - color.g * 0.8);
      color.r -= pinkF * 1.0;
      color.b -= pinkF * 0.9;
      // Crush mint/cream → cool silver; oil only in elliptical mid puddles
      float faceChroma2 = max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b)));
      float limeFlood = max(0.0, color.g - color.r * 1.02) * max(0.0, color.g - color.b * 0.98);
      float creamFlood = max(0.0, color.r - color.b * 0.98) + max(0.0, color.g * 0.86 - color.b);
      float silL2 = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 coolSil = vec3(silL2 * 1.0, silL2 * 1.0, silL2 * 0.99);
      float oilGate = clamp(ellA * 0.8 + ellB * 0.6 + ellC * 0.45 + ellD * 0.5 + ellE * 0.4 + boundary * 0.7, 0.0, 1.0) * mix(0.35, 1.0, midHotF);
      float hot = clamp(pow(faceHard, 1.65), 0.0, 1.0);
      // Gold-led oil puddles — sparse midtone accents (anti neon gold face flood)
      color = mix(color, oilAF * (max(silL2, 0.25) / max(dot(oilAF, vec3(0.2126, 0.7152, 0.0722)), 0.2)), clamp(oilGate * mix(0.28, 0.4, conceptAlive) * faceAlive, 0.0, 0.45));
      color = mix(color, coolSil, clamp((limeFlood * 2.1 + creamFlood * 1.8) * (1.0 - oilGate * 0.45) * faceAlive, 0.0, 0.95));
      float cyanMilk = max(0.0, color.b - color.r * 0.96) * max(0.0, color.b - color.g * 0.94);
      color = mix(color, coolSil, clamp(cyanMilk * 1.45 * faceAlive * (1.0 - oilGate * 0.35), 0.0, 0.94));
      color.b = mix(color.b, min(color.b, max(color.r, color.g) * 0.98), faceAlive * (1.0 - oilGate * 0.5));
      float flatDead = (1.0 - oilGate) * (1.0 - hot) * (1.0 - smoothstep(0.12, 0.35, faceChroma2));
      color = mix(color, vec3(0.04, 0.045, 0.055), clamp(flatDead * 0.75 * faceAlive * (1.0 - conceptAlive * 0.3), 0.0, 0.75));
      float dripLip = smoothstep(-0.02, -0.4, p.y);
      float bulbSpare = smoothstep(-0.15, -0.5, p.y);
      // Crush cream on planar face only — spare cream drip-bulb
      float creamLip2 = max(0.0, color.r - color.b * 0.98);
      creamLip2 = max(creamLip2, max(0.0, color.g * 0.86 - color.b));
      float faceCreamGate = dripLip * (1.0 - bulbSpare * 0.92);
      color.r -= creamLip2 * 0.85 * faceCreamGate;
      color.g -= creamLip2 * 0.5 * faceCreamGate;
      float tipSil = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color, vec3(tipSil * 1.0, tipSil * 1.0, tipSil * 0.99), clamp(creamLip2 * 0.9 * faceCreamGate, 0.0, 0.55));
      // Re-assert cream drip-bulb after face cream crush
      vec3 creamBulb2 = vec3(0.9, 0.86, 0.7);
      vec3 darkBulb2 = vec3(0.07, 0.08, 0.1);
      float bulbShade2 = clamp((-p.y - 0.28) / 0.45, 0.0, 1.0);
      color = mix(color, mix(creamBulb2, darkBulb2, bulbShade2 * 0.8), bulbSpare * 0.55 * faceAlive);
      color = max(color, creamBulb2 * bulbSpare * 0.4 * (1.0 - bulbShade2 * 0.75));
      float tipCyan2 = dripLip * max(0.0, color.b - color.r * 0.97);
      color = mix(color, vec3(tipSil * 1.02, tipSil * 1.0, tipSil * 0.96), clamp(tipCyan2 * 1.8 * faceAlive, 0.0, 0.9));
      float pkC = max(color.r, max(color.g, color.b));
      if (pkC > 0.97) color *= 0.97 / pkC;
      color.r = min(color.r, 0.96);
      color.g = min(color.g, 0.96);
      color.b = min(color.b, min(0.94, max(color.r, color.g) * 0.98));
      float forceCh = abs(color.r - color.g) + abs(color.g - color.b);
      color.r += step(forceCh, 0.05) * 0.05 * faceAlive * oilGate;
      color.g += step(forceCh, 0.05) * 0.015 * faceAlive * oilGate;
      color.b -= step(forceCh, 0.05) * 0.02 * faceAlive * oilGate;
      float gDom = max(0.0, color.g - max(color.r, color.b) * 1.04);
      float creamDom = max(0.0, color.r - color.b * 1.0) + max(0.0, color.g * 0.85 - color.b);
      float creamLowCh = creamDom * (1.0 - smoothstep(0.1, 0.26, faceChroma2));
      float finL = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 finCool = vec3(finL * 1.0, finL * 1.0, finL * 0.99);
      color = mix(color, finCool, clamp((gDom * 2.8 + creamLowCh * 2.4 + creamDom * 0.7) * faceAlive * (1.0 - oilGate * 0.25), 0.0, 0.9));
      float creamPeak = creamDom * smoothstep(0.4, 0.8, finL) * (1.0 - oilGate);
      color = mix(color, vec3(finL * 1.0, finL * 1.0, finL * 0.99), clamp(creamPeak * 2.4 * faceAlive, 0.0, 0.88));
      if (conceptAlive > 0.01) {
        float creamAll = max(0.0, color.r - color.b * 0.98) + max(0.0, color.g * 0.88 - color.b);
        float mintAll = max(0.0, color.g - color.r * 1.0) * max(0.0, color.g - color.b * 0.96);
        float cyanAll = max(0.0, color.b - color.r * 0.98) * max(0.0, color.b - color.g * 0.96);
        float cCh4 = max(abs(conceptChrome.r - conceptChrome.g), max(abs(conceptChrome.g - conceptChrome.b), abs(conceptChrome.r - conceptChrome.b)));
        float hasM4 = smoothstep(0.015, 0.07, max(conceptChrome.r, max(conceptChrome.g, conceptChrome.b)));
        float oilSpare4 = smoothstep(0.14, 0.3, cCh4) * step(conceptChrome.b + 0.03, conceptChrome.r);
        color = mix(color, vec3(finL * 1.0, finL * 1.0, finL * 0.99), clamp((creamAll * 2.0 + mintAll * 2.2 + cyanAll * 2.5) * (1.0 - oilSpare4) * conceptAlive, 0.0, 0.97));
        color = mix(color, conceptChrome, clamp(oilSpare4 * hasM4 * conceptAlive * 0.35 * faceAlive, 0.0, 0.5));
      }
      color = clamp(color, 0.0, 0.98);
      // Final wet-mirror grade: crush residual cream/mint/cyan; keep sparse gold oil
      float finCream = max(0.0, color.r - color.b * 0.98) + max(0.0, color.g * 0.88 - color.b);
      float finMint = max(0.0, color.g - color.r * 1.0) * max(0.0, color.g - color.b * 0.96);
      float finCyan = max(0.0, color.b - color.r * 0.95) * max(0.0, color.b - color.g * 0.92);
      float finCh = max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b)));
      float finLu = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float oilKeep = smoothstep(0.16, 0.34, finCh) * (1.0 - smoothstep(0.62, 0.9, finLu))
        * step(color.b + 0.03, color.r) * step(color.b, color.g + 0.02);
      color = mix(color, vec3(finLu * 1.0, finLu * 1.0, finLu * 0.99), clamp((finCream * 2.8 + finMint * 2.8 + finCyan * 2.6) * (1.0 - oilKeep) * faceAlive, 0.0, 0.98));
      float gLead = max(0.0, color.g - max(color.r, color.b) * 1.0);
      color = mix(color, vec3(finLu * 1.0, finLu * 1.0, finLu * 0.99), clamp(gLead * 2.8 * (1.0 - oilKeep) * faceAlive, 0.0, 0.95));
      // Extra cream crush: low-chroma R-lead midtones → equal silver (spare gold oil)
      float creamMid = max(0.0, color.r - color.b * 1.0) * (1.0 - smoothstep(0.12, 0.3, finCh)) * smoothstep(0.35, 0.75, finLu);
      color = mix(color, vec3(finLu, finLu, finLu * 0.995), clamp(creamMid * 2.6 * (1.0 - oilKeep) * faceAlive, 0.0, 0.94));
      // Lift B on cream softbox only (R-B gap) without crossing into cyan
      float creamGap = max(0.0, color.r - color.b) * (1.0 - smoothstep(0.14, 0.32, finCh));
      color.b = mix(color.b, min(color.r * 0.99, color.b + creamGap * 0.55), clamp(creamGap * 1.2 * (1.0 - oilKeep) * faceAlive, 0.0, 0.85));
      color.r = mix(color.r, color.b + 2.0 / 255.0, clamp(creamGap * 0.35 * (1.0 - oilKeep) * faceAlive, 0.0, 0.5));
      // Hard G/B caps on non-oil (anti mint/cyan softbox)
      float gCap = max(color.r, color.b) * 1.0;
      color.g = mix(color.g, min(color.g, gCap), (1.0 - oilKeep) * faceAlive);
      color.b = mix(color.b, clamp(color.b, color.r * 0.97, max(color.r, color.g) * 0.995), (1.0 - oilKeep) * faceAlive);
      // Tip/drip cyan softbox crush — spare cream bulb R-lead
      float tipCyan = smoothstep(-0.02, -0.35, p.y) * max(0.0, color.b - color.r * 0.97);
      float bulbGateF = 1.0 - smoothstep(-0.15, -0.5, p.y) * 0.9;
      color = mix(color, vec3(finLu * 1.0, finLu * 1.0, finLu * 0.99), clamp(tipCyan * 2.2 * faceAlive * bulbGateF, 0.0, 0.95));
      // Re-add sparse elliptical gold oil puddles for 1c6PD/Z53Ve wet-mirror richness
      // Cap neon gold saturation — planar wet-mirror softbox first, oil accents sparse
      float finLu2 = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float goldSat = max(0.0, color.r - color.b * 0.9) * max(0.0, color.r - color.g * 0.92);
      // Strong gold→silver crush on bright softbox; spare only midtone oil puddles
      color = mix(color, vec3(finLu2 * 1.01, finLu2 * 1.0, finLu2 * 0.98), clamp(goldSat * 1.85 * faceAlive * bulbGateF * (1.0 - oilGate * 0.25) * smoothstep(0.45, 0.75, finLu2), 0.0, 0.88));
      color = mix(color, oilAF * (max(finLu2, 0.22) / max(dot(oilAF, vec3(0.2126, 0.7152, 0.0722)), 0.2)), clamp(oilGate * mix(0.22, 0.32, conceptAlive) * faceAlive * bulbGateF * (1.0 - smoothstep(0.55, 0.85, finLu2)), 0.0, 0.38));
      color = mix(color, oilAF * 1.0, clamp(oilGate * ellA * 0.18 * faceAlive * bulbGateF * (1.0 - smoothstep(0.5, 0.8, finLu2)), 0.0, 0.22));
      color = mix(color, oilBF * 0.92, clamp(oilGate * ellB * 0.14 * faceAlive * bulbGateF * (1.0 - smoothstep(0.5, 0.8, finLu2)), 0.0, 0.18));
      // Final cream drip-bulb assert (after oil/cyan crush) — localized tip only
      float bulbFin = smoothstep(-0.28, -0.62, p.y);
      color = mix(color, mix(vec3(0.88, 0.84, 0.68), vec3(0.07, 0.08, 0.1), clamp((-p.y - 0.32) / 0.4, 0.0, 1.0) * 0.8), bulbFin * 0.4 * faceAlive);
      color = max(color, vec3(0.86, 0.82, 0.66) * bulbFin * 0.28 * (1.0 - clamp((-p.y - 0.32) / 0.4, 0.0, 1.0) * 0.7));
      // Soft gold re-assert on midtones only
      color = mix(color, oilAF, clamp(oilGate * 0.18 * faceAlive * bulbGateF * (1.0 - bulbFin) * (1.0 - smoothstep(0.55, 0.82, finLu2)), 0.0, 0.22));
      // Final cyan softbox kill; spare gold (R-led) oil + cream bulb
      float finCyan2 = max(0.0, color.b - color.r * 0.95) * max(0.0, color.b - color.g * 0.9);
      float goldKeepF = smoothstep(0.14, 0.32, finCh) * step(color.b + 0.05, color.r) * step(color.b + 0.02, color.g)
        * (1.0 - smoothstep(0.55, 0.85, finLu));
      goldKeepF = max(goldKeepF, oilGate * 0.4 * (1.0 - smoothstep(0.55, 0.85, finLu)));
      color = mix(color, vec3(finLu * 1.0, finLu * 1.0, finLu * 0.99), clamp(finCyan2 * 2.6 * (1.0 - goldKeepF) * faceAlive * bulbGateF, 0.0, 0.97));
      color.b = mix(color.b, min(color.b, max(color.r, color.g) * 0.97), (1.0 - goldKeepF) * faceAlive * bulbGateF);
      // Soft final gold midtone accent
      color = mix(color, oilAF, clamp(oilGate * 0.15 * faceAlive * bulbGateF * (1.0 - bulbFin) * (1.0 - smoothstep(0.5, 0.8, finLu)), 0.0, 0.2));
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
