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
          float midR = mix(topR, botR, 0.45) * mix(0.28, 0.18, viscosity);
          float cap = sdCapsule(p, lipC, botC, max(midR, 0.014));
          pane = softMin(pane, cap, mix(0.018, 0.032, viscosity));
          // Extra mid-neck capsule for freeze elegance
          vec2 midC = mix(lipC, botC, 0.42);
          float midCap = sdCapsule(p, mix(lipC, midC, 0.35), mix(midC, botC, 0.55), max(midR * 1.15, 0.016));
          pane = softMin(pane, midCap, mix(0.014, 0.028, viscosity));
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
  vec3 fringe = 0.5 + 0.5 * cos(vec3(phase, phase + 2.094, phase + 4.188));
  // Bias away from flat purple bloom toward cyan–lime fire
  fringe = mix(fringe, fringe * vec3(0.82, 1.18, 1.08), 0.6);
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
 * Knife cores (pow) = wet mirror bars; soft lobes stay dim so faces aren't pastel.
 */
vec3 studioEnv(vec3 R) {
  vec3 rn = normalize(R + 1e-5);
  vec2 e = rn.xy / (abs(rn.z) + 0.28);
  // Razor cores only — no soft shoulders (pastel wash killer)
  float softV = pow(smoothstep(0.014, 0.00015, abs(e.x + 0.26)), 5.2);
  softV *= smoothstep(-1.18, -0.06, e.y) * smoothstep(1.12, 0.1, e.y);
  float softV2 = pow(smoothstep(0.012, 0.00012, abs(e.x - 0.4)), 5.4) * 0.9;
  softV2 *= smoothstep(-1.02, -0.02, e.y) * smoothstep(1.02, 0.16, e.y);
  float softV3 = pow(smoothstep(0.016, 0.0004, abs(e.x + 0.58)), 4.6) * 0.42;
  float softV4 = pow(smoothstep(0.011, 0.00012, abs(e.x + 0.08)), 5.0) * 0.75;
  float softV5 = pow(smoothstep(0.013, 0.00018, abs(e.x - 0.18)), 5.1) * 0.7;
  float softH = pow(smoothstep(0.018, 0.0008, abs(e.y - 0.3)), 4.0) * 0.42;
  float key = pow(max(dot(rn, normalize(vec3(-0.55, 0.78, 0.42))), 0.0), 160.0);
  float fillM = pow(max(dot(rn, normalize(vec3(0.72, -0.15, 0.35))), 0.0), 36.0);
  float fillC = pow(max(dot(rn, normalize(vec3(0.05, 0.35, 0.9))), 0.0), 28.0);

  // Dark ambient floor — wet chrome, not lavender fog
  vec3 col = vec3(0.028, 0.03, 0.042);
  col += vec3(0.14, 0.18, 0.28) * (0.25 + 0.35 * max(rn.y, 0.0));
  // Hard softbox cores (white-biased; color only as thin accents)
  col += vec3(2.2, 2.05, 1.9) * softV * 6.8;
  col += vec3(1.6, 1.85, 2.15) * softV2 * 4.6;
  col += vec3(1.9, 1.1, 1.85) * softV3 * 1.8;
  col += vec3(2.1, 2.0, 1.95) * softV4 * 5.5;
  col += vec3(2.0, 1.95, 1.85) * softV5 * 5.0;
  col += vec3(1.6, 1.5, 1.4) * softH * 2.2;
  col += vec3(1.3, 1.35, 1.5) * key * 5.5;
  col += vec3(1.7, 0.2, 1.25) * fillM * 0.85;
  col += vec3(0.12, 1.35, 1.5) * fillC * 0.65;
  float star = pow(max(dot(rn, normalize(vec3(-0.4, 0.82, 0.4))), 0.0), 520.0);
  col += vec3(2.2) * star * 9.5;
  // Frontal softbox plate — hard peaks only (soft amb gated down)
  vec3 plate = texture(u_backdrop, studioPlateUv(rn)).rgb;
  float platePeak = max(plate.r, max(plate.g, plate.b));
  float hard = smoothstep(0.4, 0.82, platePeak);
  float soft = smoothstep(0.08, 0.4, platePeak) * (1.0 - hard * 0.94);
  col += plate * soft * 0.18;
  col += plate * hard * 5.8;
  return col;
}

/** Spectral edge fire: rich cyan ↔ magenta (concept art), grazing-weighted. */
vec3 edgeFire(float t, float amt) {
  vec3 cyan = vec3(0.15, 1.45, 1.55);
  vec3 mag = vec3(1.55, 0.18, 1.15);
  vec3 lime = vec3(0.55, 1.4, 0.35);
  vec3 gold = vec3(1.35, 1.05, 0.3);
  float u = smoothstep(0.0, 1.0, t);
  vec3 fire = mix(cyan, mag, smoothstep(0.08, 0.92, u));
  fire = mix(fire, lime, 0.22 * sin(u * 6.28318));
  fire = mix(fire, gold, 0.12 * sin(u * 9.42478 + 1.2));
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
    // Chrome: near-flat face = planar softbox mirror (no corrugated pillow ribs)
    // Script: cylindrical tube pillow for molten pipe volume
    float pillow = (u_glyphId > 0.5 ? 0.32 : 0.02) * (1.0 - rim) * u_bevel;
    vec2 faceWarp = p * pillow * vec2(u_glyphId > 0.5 ? 1.05 : 0.35, u_glyphId > 0.5 ? 0.88 : 0.28);
    float gAmt = mix(u_glyphId > 0.5 ? 0.08 : 0.03, 1.45, rimSharp) * (0.85 + 0.55 * u_bevel);
    vec3 dripN = dripNormalBias(p);
    N = normalize(vec3(
      g * gAmt + faceWarp + dripN.xy * (u_glyphId > 0.5 ? 1.15 : 0.55),
      mix(u_glyphId > 0.5 ? 0.62 : 0.92, 1.0, 1.0 - rimSharp * 0.5) + dripN.z * 0.5
    ));
    if (u_glyphId > 0.5) {
      // Tubular script: high medial N.z = luminous facing body (not hollow rim shell)
      float tube = mix(0.42, 2.55, rimSharp);
      vec3 Ntube = normalize(vec3(g * tube, mix(0.78, 0.26, rimSharp)));
      N = normalize(mix(N, Ntube, 0.7));
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
    // --- Wet mirror chrome: planar softbox panels + knife cores ---
    // Chrome: near-planar face → true mirror softbox panels (1c6PD/Z53Ve)
    // Script: cylindrical bend for tubular chrome wrap (ENj9B pipe elegance)
    float faceBend = u_glyphId > 0.5 ? 1.75 : 0.06;
    vec3 Ncurve = normalize(vec3(
      p * vec2(faceBend, faceBend * 0.78) * (0.45 + 0.35 * u_bevel),
      u_glyphId > 0.5 ? 0.4 : 0.995
    ));
    vec3 Rface = reflect(-V, Ncurve);
    vec3 Rlight = normalize(mix(Rface, reflect(-L, Ncurve), u_glyphId > 0.5 ? 0.42 : 0.08));
    vec3 envFace = studioEnv(Rlight);
    vec3 envRim = studioEnv(R);
    vec3 env = mix(envFace, envRim, rimSharp * 0.55);
    // Direct plate sample — panels + knife; soft amb crushed for chromeSansP
    vec2 plateUv = studioPlateUv(Rlight);
    vec3 plate = texture(u_backdrop, plateUv).rgb;
    float platePeak = max(plate.r, max(plate.g, plate.b));
    float hardBar = smoothstep(0.28, 0.72, platePeak);
    float softGate = u_glyphId > 0.5 ? 0.28 : 0.0;
    float softAmb = smoothstep(0.05, 0.28, platePeak) * (1.0 - hardBar * 0.96) * softGate;
    // Body: deep charcoal chrome / luminous silver-chrome metal (not lavender / neon pink)
    vec3 darkBody = u_glyphId > 0.5
      ? vec3(0.26, 0.22, 0.28)
      : vec3(0.004, 0.005, 0.008);
    vec3 ambTint = u_glyphId > 0.5
      ? vec3(0.55, 0.48, 0.58)
      : vec3(0.05, 0.06, 0.08);
    color = darkBody + ambTint * softAmb * 0.12;
    color += envFace * softAmb * 0.04 * u_glass;
    // Hard wet-mirror: planar panels + knife cores
    float hardMul = u_glyphId > 0.5 ? 7.2 : 11.5;
    color += plate * hardBar * hardMul * u_glass;
    color += envFace * hardBar * (u_glyphId > 0.5 ? 3.4 : 5.0) * u_glass;
    float faceReflect = mix(0.92, 1.0, fres) * u_glass;
    color = mix(darkBody * 1.02, color, faceReflect);

    // Planar face plate UV — mirror softbox panels across letter faces
    vec2 facePlateUv = clamp(
      vec2(0.5) + p * vec2(u_glyphId > 0.5 ? 1.0 : 0.95, u_glyphId > 0.5 ? 0.78 : 0.72)
        + Rlight.xy * (u_glyphId > 0.5 ? 0.12 : 0.004),
      0.0, 1.0
    );
    vec3 facePlate = texture(u_backdrop, facePlateUv).rgb;
    float facePeak = max(facePlate.r, max(facePlate.g, facePlate.b));
    float faceHard = smoothstep(0.22, 0.68, facePeak);
    float facePanel = smoothstep(0.12, 0.45, facePeak);
    color += facePlate * faceHard * (u_glyphId > 0.5 ? 6.8 : 10.5) * u_glass * (1.0 - rimSharp * 0.15);
    // Face floor — chrome: deep interstitial; script: cool metal midtone
    float faceAlive = (1.0 - rimSharp) * u_glass;
    // Broader planar panel energy (wet-mirror softbox faces, not only knife cores)
    if (u_glyphId < 0.5) {
      // Plate-driven planar face — stretch UV so few wide softboxes span the glyph
      vec2 planarUv = clamp(vec2(0.5) + p * vec2(0.55, 0.48) + Rlight.xy * 0.002, 0.0, 1.0);
      vec3 planarPlate = texture(u_backdrop, planarUv).rgb;
      float planarPeak = max(planarPlate.r, max(planarPlate.g, planarPlate.b));
      float planarHard = smoothstep(0.2, 0.65, planarPeak);
      float planarSoft = smoothstep(0.08, 0.4, planarPeak);
      color += planarPlate * planarHard * 9.5 * u_glass * faceAlive;
      color += planarPlate * planarSoft * 4.5 * u_glass * faceAlive * (1.0 - planarHard * 0.3);
      color += facePlate * facePanel * 3.2 * u_glass * faceAlive * (1.0 - faceHard * 0.25);
      color += plate * facePanel * 2.2 * u_glass * (1.0 - rimSharp * 0.2);
    }
    color = max(color, (darkBody * (u_glyphId > 0.5 ? 1.35 : 1.2) + ambTint * 0.06 + envFace * 0.1) * faceAlive);

    if (u_glyphId > 0.5) {
      // Tubular silver-chrome body + bright wrap (ENj9B elegance — luminous pipe, not black voids)
      float tubeBody = smoothstep(0.0, max(bevelW * 0.85, 0.002), inside);
      // Cylindrical Fresnel wrap — silver chrome along pipe grazing
      float wrapFres = pow(1.0 - ndotv, 1.45);
      float tubeCatch = pow(max(dot(N, H), 0.0), 18.0);
      float tubeCatch2 = pow(max(dot(N, H), 0.0), 56.0);
      vec3 tubeFill = vec3(0.52, 0.46, 0.54) + envFace * vec3(1.4, 1.35, 1.45) * 1.6;
      tubeFill += facePlate * max(faceHard, 0.5) * vec3(1.55, 1.5, 1.6) * 2.0;
      tubeFill += plate * max(hardBar, 0.45) * vec3(1.5, 1.45, 1.55) * 1.7;
      tubeFill += ambTint * 0.28;
      // Silver chrome wrap — pale metal catch along cylinder ridge
      vec3 silverWrap = vec3(0.98, 0.97, 1.0) * (wrapFres * 3.2 + tubeCatch * 4.0 + tubeCatch2 * 4.6);
      silverWrap += envFace * vec3(1.4, 1.35, 1.45) * wrapFres * 2.1;
      silverWrap += facePlate * wrapFres * 1.9;
      tubeFill = mix(tubeFill, max(tubeFill, silverWrap), clamp(wrapFres * 1.5 + tubeCatch * 1.2, 0.0, 0.94));
      float faceAmt = mix(0.96, 0.4, rimSharp) * u_glass * mix(0.85, 1.0, tubeBody);
      color = mix(color, max(color, tubeFill), faceAmt);
      color = max(color, mix(darkBody, tubeFill, 0.85) * faceAmt);
      // Luminous metal floor — filled stroke body (never black outline / neon pink)
      color = max(color, vec3(0.48, 0.42, 0.5) * mix(1.0, 0.35, rimSharp) * u_glass);
      color = max(color, tubeFill * 0.55 * tubeBody * u_glass);
    }

    vec2 e = Rlight.xy / (abs(Rlight.z) + 0.22);
    // Chrome: suppress streak ribs — planar softbox panels carry the face
    // Script: tubular wrap filaments along pipe
    float streakCore = pow(smoothstep(0.01, 0.00005, abs(e.x + 0.18)), 6.4);
    streakCore += 0.95 * pow(smoothstep(0.009, 0.00004, abs(e.x - 0.34)), 6.5);
    streakCore += 0.55 * pow(smoothstep(0.01, 0.00015, abs(e.x + 0.48)), 5.6);
    streakCore += 0.85 * pow(smoothstep(0.008, 0.00005, abs(e.x + 0.02)), 6.0);
    streakCore += 0.75 * pow(smoothstep(0.008, 0.00005, abs(e.x - 0.16)), 6.1);
    streakCore += 0.7 * pow(smoothstep(0.009, 0.00008, abs(e.x - 0.52)), 5.8);
    streakCore += 0.6 * pow(smoothstep(0.009, 0.00006, abs(e.x + 0.28)), 5.9);
    float streakShoulder = smoothstep(0.028, 0.003, abs(e.x + 0.18)) * 0.04;
    streakShoulder += 0.03 * smoothstep(0.025, 0.0025, abs(e.x - 0.34));
    float streak = (streakCore + streakShoulder) * mix(0.95, 1.55, 0.25 + 0.75 * rimSharp);
    if (u_glyphId < 0.5) {
      // Few wide softbox panels — planar mirror slabs (not dense pastel ribs)
      float panelA = smoothstep(0.14, 0.028, abs(p.x + 0.1)) * smoothstep(-0.55, 0.5, p.y);
      float panelB = smoothstep(0.13, 0.025, abs(p.x - 0.08)) * smoothstep(-0.5, 0.52, p.y);
      float panelC = smoothstep(0.12, 0.022, abs(p.x + 0.28)) * smoothstep(-0.48, 0.45, p.y);
      float panels = max(max(panelA, panelB * 0.92), panelC * 0.8) * faceAlive;
      // Sparse knife accents only (not rib field)
      float knife = pow(smoothstep(0.005, 0.00003, abs(p.x + 0.1)), 9.0);
      knife += 0.65 * pow(smoothstep(0.0045, 0.00003, abs(p.x - 0.08)), 9.0);
      knife *= faceAlive * smoothstep(-0.5, 0.48, p.y);
      // Softbox panel reflection — cool white / cyan slabs
      color += facePlate * panels * 7.5 * u_glass;
      color += plate * panels * 5.0 * u_glass;
      color += vec3(1.4, 1.55, 1.7) * panels * 3.2 * u_glass;
      color += vec3(2.7, 2.6, 2.55) * knife * 2.8 * u_glass;
      // Planar mirror on panels only — dark interstitial stays charcoal (not milky lavender)
      float mirrorFloor = faceAlive * panels * (0.85 + 0.35 * facePanel);
      color = max(color, facePlate * mirrorFloor * 5.0 + plate * mirrorFloor * 3.5);
      color = max(color, envFace * mirrorFloor * 2.4);
      // Charcoal interstitial between panels (wet-mirror contrast, not lavender ribs)
      float barMask = smoothstep(0.12, 0.55, panels + knife * 0.4);
      color = mix(darkBody * 2.2 + vec3(0.02, 0.025, 0.03), color, barMask);
      // Kill residual streak ribs on chrome faces
      streak *= 0.08;
      streakCore *= 0.1;
    } else {
      // Screen-space knife bars stay for script tubular wrap only
      float screenBar = pow(smoothstep(0.012, 0.0001, abs(p.x + 0.06)), 6.4) * smoothstep(-0.55, 0.5, p.y);
      float screenBar2 = pow(smoothstep(0.01, 0.00012, abs(p.x - 0.14)), 6.2) * smoothstep(-0.4, 0.55, p.y);
      streak = max(streak, max(screenBar * 2.2, screenBar2 * 1.6));
    }
    float barMul = u_glyphId > 0.5 ? 7.2 : 1.4;
    color += vec3(2.65, 2.45, 2.35) * streakCore * barMul * u_glass;
    color += vec3(1.05, 0.98, 0.95) * streakShoulder * 0.08 * u_glass;
    if (u_glyphId > 0.5) {
      // Tubular wrap bars — wider silver chrome filaments along pipe (ENj9B)
      float tubeAlive = smoothstep(0.0, max(bevelW * 0.85, 0.002), inside);
      vec2 Ttube = normalize(vec2(-g.y, g.x) + 1e-5);
      float wrapCoord = dot(p, Ttube);
      float tubeBar = pow(smoothstep(0.016, 0.00012, abs(wrapCoord + 0.04)), 4.8);
      tubeBar += 1.1 * pow(smoothstep(0.015, 0.0001, abs(wrapCoord - 0.08)), 4.6);
      tubeBar += 1.0 * pow(smoothstep(0.016, 0.00012, abs(wrapCoord + 0.14)), 4.4);
      tubeBar += 0.95 * pow(smoothstep(0.017, 0.00014, abs(wrapCoord - 0.02)), 4.2);
      tubeBar += 0.85 * pow(smoothstep(0.018, 0.00016, abs(wrapCoord + 0.2)), 4.0);
      // Broader chrome wrap band along cylinder ridge
      float wrapBand = smoothstep(0.1, 0.014, abs(wrapCoord + 0.02)) * 1.05;
      wrapBand += 0.9 * smoothstep(0.09, 0.016, abs(wrapCoord - 0.1));
      wrapBand += 0.75 * smoothstep(0.095, 0.018, abs(wrapCoord + 0.16));
      float wrapFres2 = pow(1.0 - ndotv, 1.3);
      tubeBar = max(tubeBar, wrapBand * (0.65 + 1.0 * wrapFres2));
      tubeBar *= faceAlive * (0.55 + 0.45 * tubeAlive);
      color += vec3(2.75, 2.65, 2.7) * tubeBar * 8.6 * u_glass;
      color += vec3(2.5, 2.4, 2.5) * streakCore * faceAlive * 4.6 * u_glass;
      color += vec3(2.35, 2.35, 2.4) * wrapFres2 * faceAlive * 2.4 * u_glass;
      color += vec3(2.1, 2.15, 2.25) * pow(rimSharp, 1.5) * faceAlive * 0.7 * u_glass;
      // Anti-void floor — keep tubular body filled (luminous silver-chrome, not neon pink)
      color = max(color, vec3(0.5, 0.44, 0.52) * tubeAlive * u_glass);
      color = max(color, envFace * vec3(0.95, 0.9, 0.98) * 0.75 * tubeAlive * u_glass);
    }
    // Thin spectral accents on rims only — not face pastel wash
    color += vec3(1.85, 0.2, 1.45) * pow(smoothstep(0.016, 0.0003, abs(e.x - 0.1)), 5.0) * 0.55 * mix(0.08, 1.0, rimSharp);
    color += vec3(0.05, 1.7, 1.85) * pow(smoothstep(0.017, 0.00035, abs(e.x + 0.02)), 4.8) * 0.5 * mix(0.08, 1.0, rimSharp);
    color += vec3(1.6, 1.45, 0.25) * pow(smoothstep(0.014, 0.0006, abs(e.y - 0.2)), 4.2) * 0.4 * mix(0.12, 1.0, rimSharp);

    color = max(color, vec3(0.0));
    // Contrast expand — crush lavender mids, keep planar mirror peaks
    if (u_glyphId < 0.5) {
      float cl = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color * 0.22, color * 1.85, smoothstep(0.22, 1.9, cl));
      // Desaturate residual lavender (B≫R,G) on face mids
      float lav = max(0.0, color.b - max(color.r, color.g) * 1.05);
      color.b -= lav * 0.72 * faceAlive;
      color.r = mix(color.r, color.g * 0.98, lav * 0.35 * faceAlive);
      color = max(color, darkBody * 1.15 * faceAlive);
    }

    vec2 T = normalize(vec2(-g.y, g.x) + 1e-5);
    float aniso = pow(max(1.0 - abs(dot(normalize(R.xy + 1e-5), T)), 0.0), 3.8);
    // Chrome: kill aniso ribs on planar faces — softbox panels only
    float anisoAmt = u_glyphId > 0.5
      ? (0.22 + 0.55 * rimSharp)
      : (0.02 + 0.35 * rimSharp);
    color += env * aniso * anisoAmt;

    // Script stroke spine — bright silver tubular ridge (chrome elegance over pink)
    if (u_glyphId > 0.5) {
      float spine = exp(-pow(inside / 0.048, 2.0) * 0.45) * (1.0 - rimSharp * 0.12);
      float wrapFresS = pow(1.0 - ndotv, 1.25);
      float tubeAliveS = smoothstep(0.0, max(bevelW * 0.9, 0.002), inside);
      color += vec3(2.4, 2.3, 2.4) * spine * 5.2 * u_glass;
      color += vec3(2.55, 2.45, 2.5) * spine * aniso * 3.6;
      color += vec3(2.4, 2.3, 2.4) * streakCore * (1.0 - rimSharp * 0.2) * 3.4 * u_glass;
      color += vec3(2.5, 2.4, 2.5) * wrapFresS * spine * 3.4 * u_glass;
      color += envFace * spine * vec3(1.55, 1.5, 1.55) * 2.0;
      // Hard anti-void — filled loop + junction midtones (luminous silver, never black / neon pink)
      color = max(color, darkBody * 3.6 * tubeAliveS * u_glass);
      color = max(color, ambTint * 1.25 * tubeAliveS * u_glass);
      color = max(color, vec3(0.55, 0.48, 0.56) * tubeAliveS * u_glass);
      color = max(color, vec3(0.92, 0.9, 0.96) * wrapFresS * tubeAliveS * 0.95 * u_glass);
    }

    vec3 rimCol = mix(vec3(1.35, 1.4, 1.55), envRim * 3.1, 0.88);
    color = mix(color, max(color, rimCol), rimSharp * (u_glyphId > 0.5 ? 0.68 : 0.55) * (0.78 + 0.22 * fres));

    if (u_glyphId > 0.5) {
      // Mild cool rim — spare silver body from magenta crush
      color = mix(color, color * vec3(1.15, 0.85, 1.12), mix(0.04, 0.38, rimSharp));
    } else {
      // chromeSansP: thin cool lip — not thick cream/beige void rim
      color = mix(color, max(color, rimCol * vec3(0.92, 0.96, 1.05)), rimSharp * 0.35);
      color = mix(color, color * vec3(0.9, 0.96, 1.08), rimSharp * 0.18);
    }

    float faceGate = 1.0 - rimSharp;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    // Crush only extreme milk — preserve knife softbox energy
    float crush = smoothstep(2.4, 3.8, luma) * faceGate * 0.1;
    color = mix(color, color * 0.82, crush);

    float specSoft = pow(max(dot(N, H), 0.0), 36.0);
    float specMid = pow(max(dot(N, H), 0.0), 110.0);
    float specStar = pow(max(dot(N, H), 0.0), 480.0);
    float specFace = pow(max(dot(Ncurve, H), 0.0), 64.0);
    vec3 L2 = normalize(vec3(0.6, 0.3, 0.85) - vec3(p, 0.0) * 0.2);
    vec3 H2 = normalize(L2 + V);
    float spec2 = pow(max(dot(N, H2), 0.0), 200.0);
    float li = u_lightIntensity * u_specular;
    color += vec3(1.1, 1.05, 0.98) * specFace * 0.7 * li * faceGate;
    color += vec3(1.05, 1.0, 0.95) * specSoft * 0.45 * li * mix(0.5, 1.0, rimSharp);
    color += vec3(1.28, 1.22, 1.15) * specMid * 1.15 * li;
    color += vec3(1.55, 1.45, 1.35) * specStar * 3.8 * li;
    color += vec3(1.1, 0.92, 1.2) * spec2 * 0.9 * li;
    float envStar = pow(max(dot(N, normalize(vec3(-0.45, 0.8, 0.5))), 0.0), 300.0);
    color += vec3(1.5, 1.4, 1.55) * envStar * 2.8 * li * mix(0.55, 1.0, rimSharp);

    float fireAmt = u_dispersion * (1.05 + 1.3 * fres) * mix(0.5, 1.95, rimSharp);
    fireAmt *= clamp(u_lightIntensity * 0.58, 0.85, 2.7);
    fireAmt *= (0.65 + 0.85 * lightDisp);
    float fireBand = pow(rim, 0.8) * mix(0.8, 1.45, rimSharp);
    float fireT = fract(ndotl * 2.5 + fres * 0.95 + length(p) * 1.25 + rimSharp * 0.48);
    float lightSide = smoothstep(-0.16, 0.92, ndotl);
    color += edgeFire(mix(0.9, 0.1, lightSide), fireAmt * fireBand * 1.8);
    color += edgeFire(mix(0.16, 0.8, lightSide), fireAmt * fireBand * 1.05 * max(lightDisp, 0.48));
    color += edgeFire(fireT, fireAmt * edge * 0.9);
    float outerFire = smoothstep(bevelW * 2.9, -aa * 0.6, d) * (1.0 - smoothstep(-aa, bevelW * 0.9, -d));
    color += edgeFire(0.28 + 0.45 * lightSide, outerFire * u_dispersion * 1.2 * u_lightIntensity);
    float halo = smoothstep(bevelW * 1.55, 0.0, inside) * (1.0 - rimSharp * 0.3);
    color += edgeFire(mix(0.18, 0.82, lightSide), halo * u_dispersion * 0.7 * (0.5 + 0.5 * lightDisp));

    float film = u_filmThickness;
    if (film > 0.001) {
      // Face film pastel-washes chrome — keep mostly on rim for both glyphs
      float faceFilm = u_glyphId > 0.5 ? faceGate * 0.22 : faceGate * 0.08;
      float thick = film * (0.45 + 0.55 * rimSharp + 0.12 * faceFilm);
      float filmStr = film * mix(0.18, 0.95, rimSharp) * (0.45 + 0.55 * ndotl);
      vec3 filmTint = thinFilm(thick, ndotv, ndotl, filmStr);
      color += (filmTint - 0.5) * filmStr * mix(0.55, 1.45, rimSharp);
      color = mix(color, color * filmTint, film * faceFilm * 0.1);
    }

    if (p.y < -0.02) {
      float dripZone = smoothstep(-0.01, -0.48, p.y);
      vec3 dripEnv = studioEnv(normalize(Rface + vec3(0.0, -0.4, 0.12)));
      // Cool chrome drip — silver/cyan catch, not neon magenta wash
      color = mix(color, max(color, dripEnv * vec3(1.35, 1.3, 1.4)), dripZone * (0.55 + 0.28 * rimSharp));
      color += vec3(1.45, 1.4, 1.4) * specStar * dripZone * 2.4 * li;
      color += edgeFire(0.55 + 0.25 * ndotl, dripZone * u_dispersion * 0.55);
      // Keep pendant midtones — silver-chrome body, not black void crush
      float dripFloor = u_glyphId > 0.5 ? 2.8 : 1.65;
      color = max(color, darkBody * dripFloor * dripZone * (1.0 - rimSharp * 0.35));
      if (u_glyphId > 0.5) {
        color = max(color, ambTint * 0.85 * dripZone * (1.0 - rimSharp * 0.3));
        color = max(color, vec3(0.5, 0.46, 0.52) * dripZone * u_glass);
        // Stem–bulb junction bridge — fill neck void with luminous silver-chrome
        float junc = smoothstep(-0.05, -0.2, p.y) * smoothstep(-0.58, -0.28, p.y);
        float juncFres = pow(1.0 - ndotv, 1.25);
        color = max(color, vec3(0.58, 0.54, 0.6) * junc * u_glass);
        color = max(color, envFace * junc * 1.1 * u_glass);
        color += vec3(0.95, 0.93, 1.0) * junc * juncFres * 1.5 * u_glass;
      } else {
        // Chrome pendant — planar chrome continuity into bulb
        color = max(color, vec3(0.35, 0.38, 0.45) * dripZone * u_glass);
        color = max(color, facePlate * dripZone * 1.2 * u_glass);
      }
      color += vec3(1.2, 1.2, 1.3) * envStar * dripZone * 1.4 * li;
    }

    color = mix(color, color + refracted * 0.18, rimSharp * 0.14 * u_glass);

    // Soft tone-map — knife peaks stay chromatic (never equal-white; never cream wash)
    float peak = max(color.r, max(color.g, color.b));
    color = color / (1.0 + peak * (u_glyphId > 0.5 ? 0.1 : 0.12));
    if (u_glyphId > 0.5) {
      float silverCore = pow(max(dot(N, H), 0.0), 22.0);
      silverCore = max(silverCore, streakCore * faceAlive * 1.25);
      silverCore = max(silverCore, pow(max(dot(Ncurve, H), 0.0), 20.0));
      silverCore = max(silverCore, pow(1.0 - ndotv, 1.35) * 1.05);
      // Recompute wrap filaments for post-tint silver (survive magenta crush)
      vec2 Tsil = normalize(vec2(-g.y, g.x) + 1e-5);
      float wCoord = dot(p, Tsil);
      float wrapSil = pow(smoothstep(0.018, 0.00018, abs(wCoord + 0.04)), 4.2);
      wrapSil += 1.05 * pow(smoothstep(0.017, 0.00016, abs(wCoord - 0.08)), 4.0);
      wrapSil += 0.95 * pow(smoothstep(0.018, 0.00018, abs(wCoord + 0.14)), 3.8);
      wrapSil = max(wrapSil, smoothstep(0.09, 0.016, abs(wCoord + 0.02)) * 0.9);
      wrapSil = max(wrapSil, smoothstep(0.08, 0.015, abs(wCoord - 0.1)) * 0.8);
      wrapSil = max(wrapSil, smoothstep(0.085, 0.018, abs(wCoord + 0.16)) * 0.7);
      silverCore = max(silverCore, wrapSil * faceAlive * 1.65);
      // Spine midtones also count as silver (broad tubular chrome)
      silverCore = max(silverCore, exp(-pow(inside / 0.05, 2.0) * 0.4) * faceAlive * 0.85);
      // Cool body tint — spare silver for tubular chrome (keep luminous midtones, kill pink)
      color *= mix(vec3(0.98, 0.88, 0.98), vec3(1.0, 0.99, 1.02), clamp(silverCore * 2.8, 0.0, 1.0));
      color = max(color, vec3(0.36, 0.3, 0.38) * (1.0 - rimSharp * 0.35) * u_glass * (1.0 - silverCore * 0.55));
      // Inject silver chrome wrap after tint
      vec3 silverFil = vec3(0.99, 0.98, 1.0);
      color = mix(color, max(color, silverFil), clamp(silverCore * 2.7, 0.0, 0.95));
      color += vec3(0.65, 0.78, 0.92) * silverCore * 1.0;
      color += vec3(0.9, 0.92, 0.98) * silverCore * silverCore * 0.8;
      // Final anti-void after silver mix — luminous filled body
      color = max(color, vec3(0.48, 0.42, 0.5) * (1.0 - rimSharp * 0.35) * u_glass);
      float pk = max(color.r, max(color.g, color.b));
      float chroma = max(abs(color.r - color.g), max(abs(color.g - color.b), abs(color.r - color.b)));
      if (pk > 0.98 && chroma < 0.035) {
        color *= vec3(0.94, 0.97, 1.0);
      } else if (pk > 1.4) {
        color *= 1.15 / pk;
      }
      color = clamp(color, 0.0, 0.995);
      color.g = mix(min(color.g, color.r * 0.92), color.g, clamp(silverCore * 3.0, 0.0, 1.0));
    } else {
      color *= vec3(1.02, 1.0, 1.04);
      // Deep charcoal face floor between softbox panels (not lavender interstitial)
      color = max(color, darkBody * 1.08 * (1.0 - rimSharp) * u_glass);
      float pk = max(color.r, max(color.g, color.b));
      if (pk > 1.15) {
        color *= vec3(0.96, 0.98, 1.02) / pk * 0.99;
      }
      color = clamp(color, 0.0, 0.995);
      // Kill lavender leftover (B overshoot on face)
      float lav2 = max(0.0, color.b - max(color.r, color.g));
      color.b -= lav2 * 0.55 * (1.0 - rimSharp);
      // Force cool chroma on near-white knife cores
      if (color.r > 0.92 && color.g > 0.92 && color.b > 0.92) {
        color *= vec3(0.94, 0.97, 1.0);
      }
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
