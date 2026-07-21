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
      // Glyph: tight softMin — preserve hairline filament
      float k = u_fieldMode > 0.5
        ? mix(0.012, 0.028, viscosity)
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
        for (int i = 0; i < 24; i++) {
          if (i >= u_blobCount) break;
          vec4 b = u_blobs[i];
          if (b.w < 0.15 || b.z < 1e-5) continue;
          if (b.y > topY) { topY = b.y; topC = b.xy; topR = b.z; }
          if (b.y < botY) { botY = b.y; botC = b.xy; botR = b.z; }
        }
        if (topY - botY > 0.03) {
          vec2 lipC = topC + vec2(0.0, max(0.035, topR * 0.55));
          // Continuous elegant mid-filament (readable neck, not fragmented)
          float midR = mix(topR, botR, 0.55) * mix(0.14, 0.055, viscosity);
          float cap = sdCapsule(p, lipC, botC, max(midR, 0.0055));
          pane = softMin(pane, cap, mix(0.011, 0.022, viscosity));
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
 * High-contrast procedural studio for chrome glyphs.
 * Razor softbox cores + soft shoulders — wet mirror bars without black voids.
 */
vec3 studioEnv(vec3 R) {
  vec3 rn = normalize(R + 1e-5);
  vec2 e = rn.xy / (abs(rn.z) + 0.34);
  // Primary bars: hard cores (pow) over soft shoulders (coverage)
  float softV = mix(
    smoothstep(0.11, 0.014, abs(e.x + 0.26)),
    pow(smoothstep(0.032, 0.0012, abs(e.x + 0.26)), 2.35),
    0.72
  );
  softV *= smoothstep(-1.18, -0.06, e.y) * smoothstep(1.12, 0.1, e.y);
  float softV2 = mix(
    smoothstep(0.09, 0.012, abs(e.x - 0.4)) * 0.72,
    pow(smoothstep(0.028, 0.001, abs(e.x - 0.4)), 2.4) * 0.72,
    0.7
  );
  softV2 *= smoothstep(-1.02, -0.02, e.y) * smoothstep(1.02, 0.16, e.y);
  float softV3 = pow(smoothstep(0.045, 0.004, abs(e.x + 0.58)), 1.9) * 0.42;
  float softH = pow(smoothstep(0.048, 0.006, abs(e.y - 0.3)), 1.7) * 0.58;
  float softH2 = pow(smoothstep(0.055, 0.009, abs(e.y + 0.52)), 1.55) * 0.32;
  float key = pow(max(dot(rn, normalize(vec3(-0.55, 0.78, 0.42))), 0.0), 88.0);
  float fillM = pow(max(dot(rn, normalize(vec3(0.72, -0.15, 0.35))), 0.0), 26.0);
  float fillC = pow(max(dot(rn, normalize(vec3(0.05, 0.35, 0.9))), 0.0), 16.0);
  float fillY = pow(max(dot(rn, normalize(vec3(-0.2, 0.55, 0.7))), 0.0), 34.0);
  float fillL = pow(max(dot(rn, normalize(vec3(0.45, 0.6, 0.5))), 0.0), 20.0);

  vec3 col = vec3(0.006, 0.008, 0.014);
  col += vec3(1.55, 1.38, 1.2) * softV * 4.05;
  col += vec3(0.48, 0.98, 1.45) * softV2 * 2.55;
  col += vec3(1.28, 0.52, 1.18) * softV3 * 1.35;
  col += vec3(1.2, 1.08, 0.98) * softH * 1.55;
  col += vec3(0.32, 1.2, 1.32) * softH2 * 1.0;
  col += vec3(1.05, 1.1, 1.25) * key * 3.9;
  col += vec3(1.6, 0.2, 1.1) * fillM * 1.7;
  col += vec3(0.12, 1.3, 1.4) * fillC * 1.25;
  col += vec3(1.35, 1.18, 0.22) * fillY * 0.95;
  col += vec3(0.5, 1.4, 0.42) * fillL * 0.78;
  float star = pow(max(dot(rn, normalize(vec3(-0.4, 0.82, 0.4))), 0.0), 320.0);
  col += vec3(1.7) * star * 6.2;
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
    // Opaque dark plate — SwiftShader treats cleared alpha as white otherwise
    outColor = vec4(0.031, 0.031, 0.039, 1.0);
    return;
  }

  vec2 g = gradField(p, halfSize, radius);
  float edge = smoothstep(0.08, 0.0, abs(d));
  float inside = max(-d, 0.0);
  // Glyph: chrome lip — script uses thin bevel so tubular face isn't rim-voided
  float bevelW = u_fieldMode > 0.5
    ? (u_glyphId > 0.5 ? mix(0.006, 0.016, u_bevel) : mix(0.022, 0.05, u_bevel))
    : mix(0.055, 0.11, u_bevel);
  float rim = 1.0 - smoothstep(0.0, bevelW, inside);
  float rimSharp = pow(rim, u_glyphId > 0.5 ? 1.65 : 1.35);
  float z = u_bevel * edge * 0.85;
  vec3 N;
  if (u_fieldMode > 0.5) {
    // Mild pillow — curved chrome faces catch softbox streaks
    float pillow = (u_glyphId > 0.5 ? 0.28 : 0.18) * (1.0 - rim) * u_bevel;
    vec2 faceWarp = p * pillow * vec2(1.05, 0.85);
    float gAmt = mix(0.12, 1.55, rimSharp) * (0.85 + 0.55 * u_bevel);
    vec3 dripN = dripNormalBias(p);
    N = normalize(vec3(
      g * gAmt + faceWarp + dripN.xy * 1.15,
      mix(0.55, 1.0, 1.0 - rimSharp * 0.55) + dripN.z * 0.5
    ));
    if (u_glyphId > 0.5) {
      // Tubular script: stronger cylinder normals for spine catch-lights
      N = normalize(mix(N, normalize(vec3(g * mix(0.55, 2.1, rimSharp), 0.42)), 0.55));
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
    // --- Wet mirror chrome: position-bent env (flat SDF faces need fake curvature) ---
    // Stronger curvature warp → sharper softbox bar motion across faces
    vec3 Ncurve = normalize(vec3(p * vec2(2.15, 1.75) * (0.72 + 0.55 * u_bevel), 0.4));
    vec3 Rface = reflect(-V, Ncurve);
    vec3 Rlight = normalize(mix(Rface, reflect(-L, Ncurve), 0.42));
    vec3 envFace = studioEnv(Rlight);
    vec3 envRim = studioEnv(R);
    vec3 env = mix(envFace, envRim, rimSharp * 0.62);
    vec2 plateUv = clamp(0.5 + 0.5 * Rlight.xy / (abs(Rlight.z) + 0.28), 0.0, 1.0);
    vec3 plate = sampleBlur(plateUv, 0.0);
    float plateLuma = max(plate.r, max(plate.g, plate.b));
    env += plate * smoothstep(0.04, 0.32, plateLuma) * 2.55;
    // Lift script body off black void — deep magenta metal with readable midtones
    vec3 darkBody = u_glyphId > 0.5
      ? vec3(0.22, 0.055, 0.18)
      : vec3(0.04, 0.042, 0.06);
    float faceReflect = mix(0.82, 1.0, fres) * u_glass;
    // Screen-space studio plate — wet mirror softboxes independent of flat normals
    vec2 facePlateUv = clamp(vec2(0.5) + p * vec2(0.92, 0.75) + Rlight.xy * 0.14, 0.0, 1.0);
    vec3 facePlate = sampleBlur(facePlateUv, 0.0);
    vec3 chrome = max(env * 1.28, facePlate * 1.85);
    // Softbox-gated wet mirror: bright bars, but keep face floor lit (no black voids)
    float softLuma = max(chrome.r, max(chrome.g, chrome.b));
    float softGate = smoothstep(0.02, 0.35, softLuma);
    float faceFloor = u_glyphId > 0.5 ? 0.82 : 0.62;
    color = mix(darkBody, chrome, faceReflect * mix(faceFloor, 1.0, softGate));
    color += chrome * softGate * (0.6 + 0.25 * (1.0 - rimSharp)) * u_glass;
    color += envFace * mix(0.28, 0.42, softGate) * u_glass;
    // Face luminance floor — never punch black voids into chrome faces
    float faceAlive = (1.0 - rimSharp) * u_glass;
    color = max(color, mix(darkBody * 1.4, chrome * 0.55 + darkBody, 0.7) * faceAlive);
    // Script: force tubular chrome fill — stroke center must never read as plate black
    if (u_glyphId > 0.5) {
      vec3 tubeFill = vec3(0.62, 0.14, 0.52) + envFace * vec3(1.45, 0.55, 1.3) * 0.62;
      tubeFill += facePlate * vec3(1.25, 0.6, 1.2) * 0.75;
      float faceAmt = (1.0 - rimSharp * 0.5) * u_glass;
      color = max(color, mix(darkBody, tubeFill, 0.9) * faceAmt + darkBody * (1.0 - faceAmt));
      color = mix(color, max(color, tubeFill), faceAmt * 0.7);
    }

    vec2 e = Rlight.xy / (abs(Rlight.z) + 0.26);
    // Razor wet-mirror softbox bars over soft shoulder base
    float streakCore = pow(smoothstep(0.036, 0.0007, abs(e.x + 0.18)), 2.7);
    streakCore += 0.92 * pow(smoothstep(0.028, 0.0006, abs(e.x - 0.34)), 2.8);
    streakCore += 0.55 * pow(smoothstep(0.028, 0.002, abs(e.x + 0.48)), 2.4);
    float streakShoulder = smoothstep(0.12, 0.02, abs(e.x + 0.18)) * 0.35;
    streakShoulder += 0.28 * smoothstep(0.1, 0.018, abs(e.x - 0.34));
    float streak = (streakCore + streakShoulder) * mix(0.85, 1.4, 0.2 + 0.8 * rimSharp);
    float screenBar = pow(smoothstep(0.055, 0.002, abs(p.x + 0.06)), 2.6) * smoothstep(-0.55, 0.5, p.y);
    float screenBar2 = pow(smoothstep(0.048, 0.003, abs(p.x - 0.14)), 2.5) * smoothstep(-0.4, 0.55, p.y);
    float screenBar3 = pow(smoothstep(0.042, 0.004, abs(p.x + 0.18)), 2.3) * smoothstep(-0.35, 0.42, p.y) * 0.6;
    streak = max(streak, max(screenBar * 1.4, max(screenBar2 * 0.95, screenBar3)));
    color += vec3(1.95, 1.62, 1.32) * streakCore * 2.15 * u_glass;
    color += vec3(1.4, 1.3, 1.2) * streakShoulder * 0.85 * u_glass;
    color += vec3(1.6, 0.18, 1.25) * pow(smoothstep(0.048, 0.0025, abs(e.x - 0.1)), 2.4) * 1.0 * mix(1.0, 0.28, rimSharp);
    color += vec3(0.06, 1.5, 1.65) * pow(smoothstep(0.05, 0.0035, abs(e.x + 0.02)), 2.35) * 1.05 * mix(1.0, 0.28, rimSharp);
    color += vec3(1.4, 1.25, 0.16) * pow(smoothstep(0.042, 0.006, abs(e.y - 0.2)), 2.0) * 0.62 * mix(0.9, 0.22, rimSharp);

    // Never emit pure equal-RGB white (SwiftShader clear filter); keep chrome tinted
    color = max(color, vec3(0.0));
    color = mix(color, color * vec3(1.02, 0.98, 1.04), 0.35);

    vec2 T = normalize(vec2(-g.y, g.x) + 1e-5);
    float aniso = pow(max(1.0 - abs(dot(normalize(R.xy + 1e-5), T)), 0.0), 3.2);
    color += env * aniso * (0.28 + 0.55 * rimSharp);

    // Script stroke spine — hot filament ridge along medial axis (ENj9B elegance)
    if (u_glyphId > 0.5) {
      float spine = exp(-pow((inside - 0.01) / 0.012, 2.0) * 2.8);
      spine *= mix(0.55, 1.0, 1.0 - rimSharp * 0.4);
      color += vec3(1.65, 1.25, 1.55) * spine * 1.45 * u_glass;
      color += vec3(1.8, 0.65, 1.55) * spine * aniso * 1.05;
      // Extra softbox catch on cylinder face
      color += vec3(1.5, 1.2, 1.4) * streak * (1.0 - rimSharp) * 0.55 * u_glass;
    }

    vec3 rimCol = mix(vec3(1.15, 1.2, 1.3), envRim * 2.55, 0.85);
    color = mix(color, max(color, rimCol), rimSharp * (0.68 + 0.32 * fres));

    if (u_glyphId > 0.5) {
      // Magenta chrome body tint — rim hotter, face still readable midtones
      color = mix(color, color * vec3(1.4, 0.55, 1.3), mix(0.12, 0.72, rimSharp));
    } else {
      color = mix(color, color * vec3(0.78, 0.98, 1.3), rimSharp * 0.42);
    }

    float faceGate = 1.0 - rimSharp;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    // Only crush extreme milk — preserve softbox energy (never void faces)
    float crush = smoothstep(2.0, 3.4, luma) * faceGate * 0.14;
    color = mix(color, color * 0.78, crush);

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
      float thick = film * (0.5 + 0.5 * rimSharp + 0.2 * faceGate);
      float filmStr = film * mix(0.28, 0.9, rimSharp) * (0.5 + 0.5 * ndotl);
      vec3 filmTint = thinFilm(thick, ndotv, ndotl, filmStr);
      color += (filmTint - 0.5) * filmStr * 1.45;
      color = mix(color, color * filmTint, film * faceGate * 0.4);
    }

    if (p.y < -0.02) {
      float dripZone = smoothstep(-0.01, -0.48, p.y);
      vec3 dripEnv = studioEnv(normalize(Rface + vec3(0.0, -0.4, 0.12)));
      color = mix(color, max(color, dripEnv * 1.4), dripZone * (0.55 + 0.35 * rimSharp));
      color += vec3(1.55, 1.4, 1.5) * specStar * dripZone * 2.8 * li;
      color += edgeFire(0.3 + 0.45 * ndotl, dripZone * u_dispersion * 1.15);
      color = mix(color, darkBody * 1.1, dripZone * (1.0 - rimSharp) * 0.22);
      color += vec3(1.3, 1.15, 1.4) * envStar * dripZone * 1.6 * li;
    }

    color = mix(color, color + refracted * 0.18, rimSharp * 0.14 * u_glass);

    // Tone-map before FB clamp — preserve softbox tint vs SwiftShader clear white
    color = color / (1.0 + color * 0.42);
    color *= vec3(1.06, 0.99, 1.08);
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
    // Soft edge into dark plate
    vec3 plate = vec3(0.031, 0.031, 0.039);
    color = mix(plate, color, mask);
  }

  // Premultiplied alpha output
  outColor = vec4(color * alpha, alpha);
}
`;
