# Drop Modeling Research — klaut-liquid-glass

Deep dive on how to model **frozen viscous gravity deformation** of the klaut.pro glass wordmark (and the older continuum pendant path). Sources: concept art (`klaut.pro/concept_art`), public papers, VFX talks, WebGL demos, and in-repo engine notes (`GravityMeltSim.ts`, `DripSim.ts`).

**Critical correction (2026-07):** Concept art is **molten chrome/glass letterforms that sagged and solidified** — continuous letter body → teardrop neck → bulb. **Do not** attach separate emitter blobs under letters for the default look. Upper glyph may be completely frozen; only a tunable bottom band yields.

**Research tools this pass:** `user-klaut-research` `research_search_papers` + WebSearch + direct PDF fetches (Balmforth / viscous catenary / hanging filaments).

---

## 1. Physics we care about

### 1.1 Young–Laplace / pendant shape

A hanging drop balances **surface tension** vs **gravity**. Capillary pressure:

\[
\Delta p = \sigma \left(\frac{1}{r_1} + \frac{1}{r_2}\right)
\]

(Young–Laplace). Under gravity the hydrostatic head varies with height, so principal radii change → classic **pear / pendant** silhouette used in optical tensiometry (KRÜSS, DataPhysics, Biolin).

**Steal for us:** Shape factor / Bond number intuition — high \(\sigma\) / high viscosity → rounder, shorter pendants; low viscosity → longer necks before pinch. Map UI `viscosity` → neck length ↑, stretch speed ↓, tip radius ↑ (already in `DripSim.viscosityMaps`).

Refs:
- KRÜSS — [Pendant drop](https://www.kruss-scientific.com/en/know-how/glossary/pendant-drop)
- DataPhysics — [How does the pendant drop method work?](https://www.dataphysics-instruments.com/us/knowledge-hub/pendant-drop-method/)
- Biolin — [Pendant drop method for surface tension](https://www.biolinscientific.com/blog/pendant-drop-method-for-surface-tension-measurements)

### 1.2 Rayleigh–Plateau instability

A liquid cylinder / ligament is unstable to axial perturbations with wavelength \(\lambda \gtrsim 2\pi R\). Surface tension drives growth; viscosity slows growth and delays pinch-off. Breakup produces primary drops (+ satellites).

**Steal for us:** Detach when **neck radius** falls below a threshold (proxy for capillary pinch), not on a fixed timer. Viscosity should lengthen the stretch phase before detach — matches our fill→stretch→free phases.

Refs:
- Szewc et al. — *Smoothed particle hydrodynamics modelling of the Rayleigh-Plateau instability*, J. Theor. Appl. Mech. 56(3), 2018. https://doi.org/10.15632/jtam-pl.56.3.675
- Chaudhri et al. — *Fluctuating hydrodynamics and the Rayleigh–Plateau instability*, PNAS Nexus / PMC, 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10372655/ (thermal noise matters at nano scales; ignore for glass logo)

### 1.3 Continuum Surface Force (CSF)

Brackbill, Kothe & Zemach (1992) replace singular interface tension with a **volume force** across a finite-thickness color / level-set band:

\[
\mathbf{F}_{st} \propto \sigma\,\kappa\,\nabla c
\]

where \(\kappa\) is interface curvature and \(c\) a smoothed color field. Recovers Laplace pressure as interface thickness → 0.

**Steal for us:** In shaders / CPU metaballs, “surface tension” ≈ **curvature-seeking merge** (`smoothMin` / field sum toward threshold) rather than explicit \(\mathbf{F}_{st}\). CSF is the continuum justification for field-based drips.

Ref:
- Brackbill, J.U., Kothe, D.B., Zemach, C. — *A Continuum Method for Modeling Surface Tension*, J. Comput. Phys. 100, 335–354 (1992). https://ui.adsabs.harvard.edu/abs/1992JCoPh.100..335B/abstract

### 1.4 Dimensionless numbers (artist knobs ↔ physics)

| Number | Meaning | UI mapping |
|--------|---------|------------|
| **Bond** \(Bo = \rho g L^2 / \sigma\) | gravity vs tension | tip sag / pearness |
| **Ohnesorge** \(Oh = \mu / \sqrt{\rho \sigma L}\) | viscosity vs inertia+tension | `viscosity` slider |
| **Weber** \(We = \rho U^2 L / \sigma\) | inertia vs tension | drip eject speed |

High Oh → syrupy filaments; low Oh → fast pinch + satellite beads.

---

## 2. Simulation families (prior art)

### 2.1 SPH (Smoothed Particle Hydrodynamics)

Müller, Charypar & Gross (SCA 2003) derive pressure / viscosity / surface-tension force densities from Navier–Stokes for interactive free surfaces (~thousands of particles then; tens of thousands with GPU neighbor search today).

- Pros: natural free surfaces, topology change (merge/split) free.
- Cons: **neighborhood search** dominates cost; WebGL neighbor search is painful without compute.

Refs:
- Müller, M., Charypar, D., Gross, M. — *Particle-Based Fluid Simulation for Interactive Applications*, SCA 2003. https://matthias-research.github.io/pages/publications/sca03.pdf
- Surface tension in SPH (CSF-style color gradient): e.g. modeling 2D droplet ST with modified CSF — https://doi.org/10.1002/fld.4663
- Akinci et al. — *Versatile Surface Tension and Adhesion for SPH Fluids*, TOG 2013 (cited heavily in VFX drip work)

### 2.2 MLS-MPM (Moving Least Squares Material Point Method)

Hu et al. (SIGGRAPH 2018) accelerate MPM via MLS transfers. Particles ↔ background grid (P2G / G2P); **no particle neighbor search**. Codrops / matsuoka-601 WebGPU demos: ~100k particles realtime on iGPU + Screen-Space Fluid Rendering (SSFR).

- Pros: best browser particle performance path (WebGPU `atomicAdd`).
- Cons: WebGPU-only for sane implement; overkill for **logo drips** attached to a glass mesh; SSFR is a separate look from refractive `MeshPhysicalMaterial` / SDF glass.

Refs:
- Hu, Y. et al. — *A Moving Least Squares Material Point Method with Displacement Discontinuity and Two-Way Rigid Body Coupling*, SIGGRAPH 2018. https://yzhu.io/publication/mpmmls2018siggraph/paper.pdf
- Codrops — *WebGPU Fluid Simulations* (Matsuoka, 2025). https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/
- GitHub — https://github.com/matsuoka-601/WebGPU-Ocean
- nialltl MPM guide — https://nialltl.neocities.org/articles/mpm_guide

### 2.3 FLIP / APIC + SDF curvature (film / VFX)

Weta SIGGRAPH 2019 talk: thin films & drips on character skin (Alita). Adapt FLIP with:
- Explicit surface tension via **mean curvature of fluid SDF × σ** in pressure BC (Wang et al. 2005).
- Variational viscosity (Batty & Bridson 2008) — viscosity matters at mm scale even for water.
- Contact-angle SDF extrapolation into solids for adhesion.
- Viscosity boost in a thin band near solids → cling / capillary waves.

**Steal for us:** Contact-angle / adhesion metaphor for drips **stuck to glyph lips**; viscosity band near mesh surface; curvature-driven pinch. Not the overnight 5–20M particle budgets.

Refs:
- Stomakhin, Moffat, Boyle — *A Practical Guide to Thin Film and Drips Simulation*, SIGGRAPH 2019 Talks. https://www.wetafx.co.nz/assets/Uploads/PDFs/siggraph2019_drips-v2.pdf
- Wang, Mucha, Turk — *Water Drops on Surfaces*, TOG 2005.

### 2.4 Surface-only liquids (mesh BEM)

Da, Hahn, Batty, Wojtan & Grinspun (SIGGRAPH 2016) simulate inviscid liquids with a **triangle-mesh surface only** (boundary-element solve for tension / gravity / contact). Explicitly reproduces tap dripping via Rayleigh–Plateau neck thinning → pinch-off, plus droplet collisions (Weber regimes).

**Steal for us:** Conceptual north star for “neck thins → detach” without a volume grid. Too heavy / inviscid for live WebGL logos; cite as morphology reference, not runtime.

Ref: https://doi.org/10.1145/2897824.2925899 · PDF https://pub.ista.ac.at/group_wojtan/projects/2016_Da_SOL/2016_Da_SOL.pdf

### 2.5 Metaball / SDF `smoothMin` (real-time WebGL look)

Industry standard for **readable liquid logos**: compose spheres / capsules with Quilez `smin`, optionally raymarch. Codrops 2025 droplet metaballs + TSL liquid raymarch tutorials.

Quadratic smooth-min (Quilez):

\[
h = \mathrm{clamp}\!\left(0.5 + 0.5\frac{b-a}{k}, 0, 1\right),\quad
\mathrm{smin}(a,b,k) = \mathrm{mix}(b,a,h) - k\,h(1-h)
\]

**Steal for us:** Already core of `@klaut-pro/klaut-liquid-glass` shade stack (`shaders.ts` softMin + CPU `DripSim` blobs). Viscosity → larger \(k\) (fatter necks) + slower CPU phase advance.

Refs:
- Inigo Quilez — [Smooth minimum](https://iquilezles.org/articles/smin/), [Distance functions](https://iquilezles.org/articles/distfunctions/)
- Codrops — *Interactive droplet-like metaballs* (2025). https://tympanus.net/codrops/2025/06/09/how-to-create-interactive-droplet-like-metaballs-with-three-js-and-glsl/
- Codrops — *Liquid raymarching with TSL* (2024). https://tympanus.net/codrops/2024/07/15/how-to-create-a-liquid-raymarching-scene-using-three-js-shading-language/
- Engine: `src/field/DripSim.ts`, `src/field/Metaball.ts`, `docs/liquid-glass-research.md` Tier C

---

## 3. What we already ship

### 3.1 Default brand look — `GravityMeltSim` (frozen mesh sag)

Scratch stage 5 deforms **wordmark mesh vertices** with a height-masked gravity field, one-shot settles, then **freezes**. No pendant sphere pool.

| Knob | Meaning |
|------|---------|
| `intensity` (Gravity) | How far bottoms hang |
| `freezeHeight` | Fraction from **top** that stays identity (0.55 ≈ concept) |
| `falloffPower` | Sharpness of yield band below freeze line |
| `viscosity` | Neck thickness, bulb fatness, settle speed (Oh-proxy) |

Yield weight:

\[
w(h) = 0 \quad (h \ge h_{\mathrm{freeze}}),\quad
w(h) = \left(\frac{h_{\mathrm{freeze}}-h}{h_{\mathrm{freeze}}}\right)^{p}
\quad (h < h_{\mathrm{freeze}})
\]

where \(h\) is normalized height (0 bottom … 1 top). Target displacement: downward sag + mid-band radial **neck pinch** + tip **bulb grow** along preferential stem columns — continuous geometry, same mesh.

### 3.2 Optional continuum — `DripSim` (field / glassify panes)

`DripSim` remains a **practical continuum proxy** for 2D field glassify (not the scratch wordmark default):

1. Mass at bottom emitters → stretch neck → pinch → free drops.
2. softMin blends blobs into pane field.

**Do not** use attached drip blobs as the default wordmark look.

---

## 4. Ranked recommendations (post concept-art correction)

### ★ Rank 1 — Frozen viscoplastic mesh sag (`GravityMeltSim`) — **SHIPPED DEFAULT**

**Why #1:** Matches concept art exactly — solidified pendant lettering, frozen upper band, tunable affected fraction, continuous neck/bulb, rotatable glass material unchanged.

**Physics steal:**
- **Yield-stress / Herschel–Bulkley:** regions below yield act as rigid plugs (our freeze-height band); yielded regions stretch under \(g\) then stop when stresses drop (Balmforth & Hewitt 2013; Balmforth et al. Annu. Rev. Fluid Mech.).
- **Viscous catenary / hanging filaments:** gravity vs viscous resistance sets hang morphology; we bake a static target instead of running to pinch-off (Teichman & Mahadevan 2003; Le Merrer et al. 2008; Koulakis et al.).
- **Ohnesorge maps:** viscosity → thicker necks, fatter bulbs, slower settle (same artist vocabulary as old drip path).

**Pipeline:**

```
GLB wordmark → bind rest pose → yield mask(freezeHeight)
  → analytic pendant target (sag + neck + bulb)
  → one-shot ease 0→1 → freeze pose
  → MeshPhysicalMaterial glass (orbit unchanged)
```

### ★ Rank 2 — Continuum emitters + softMin (`DripSim`) — field / pane only

Keep for 2D glassify liquify panes and experimental overlays. **Not** the scratch default. Attached spheres under letters read as floating orbs — rejected vs concept art.

### ★ Rank 3 — Screen-space SDF pendants (cheap landing loops)

Shader-only hang under letter bottoms; no mesh edit. Good for lightweight marketing loops; weaker continuity than Rank 1.

### ★ Rank 4 — WebGPU MLS-MPM (optional hero)

Defer — fights refractive glass wordmark readability.

### Not recommended as primary

| Approach | Why skip as default |
|----------|---------------------|
| Attached drip blob spheres on wordmark | Concept art = continuous letter body, not emitters |
| Full SPH in WebGL2 | Neighbor cost vs visual gain |
| Offline FLIP (Weta-scale) | Bake B-roll only |
| Continuous ongoing drip animation | Concept is **frozen / once-settled** |

---

## 5. Practical WebGL pipeline (wordmark default)

```
Blender bake: Arial Black "klaut.pro" → wordmark-klaut-pro.glb
        ↓
Three.js MeshPhysicalMaterial glass (orbit / IOR)
        ↓
GravityMeltSim.bind(rest pose)
        ↓
UI: gravity · freezeHeight · viscosity
        ↓
Yield mask (top frozen) → pendant target (sag + neck + bulb)
        ↓
One-shot settle → freeze (static sculpture)
```

**Viscosity cheat sheet (mesh sag):**

| viscosity | sagAmp | neckPinch | bulbGrow | settle | look |
|-----------|--------|-----------|----------|--------|------|
| low (~0.15) | shorter | sharper / thinner | smaller tip | fast | watery stretch drips |
| mid (~0.55) | medium | medium | medium pear | mid | syrup glass |
| high (~0.78–0.9) | longer hang | thick neck | **fat honey bulb** | slow | honey / molten chrome |

**Honey morphology (2026-07):** tip **remesh** — continuous pear-of-revolution
lattices (thick lip → taper neck → squashed teardrop bulb) appended per drip
column (`buildHoneyTipCapsuleBuffers`), then **shared-vertex loft** into the
letter mesh (`weldHoneyTipIntoLetter`: letter bottom index-remapped onto tip
ring-0 + denser loft rings buried into the glyph). **Soft lip join**
(`softenHoneyLipJoin`): soft-boolean radial blend + Laplacian/Taubin on loft +
tip collar so the join reads as one continuous surface (no dual-vertex faceted
crease). Hard-projected by `sculptHoneyPendant` / `honeyPendantPoint`. Jagged
lip strands snapped at weld + seal. Still **no attached drip sphere meshes**
(`dripBlobs: 0`). Dark plate defaults.

**Freeze-height cheat sheet:**

| freezeHeight | Affected band | Look |
|--------------|---------------|------|
| 0.25 | most of glyph yields | melty soup (avoid for brand) |
| 0.55 | bottom ~45% | concept art match |
| 0.80 | only lips | subtle weighted baseline |

Field-pane `DripSim.viscosityMaps` still apply to glassify only.

---

## 5b. Why attached blobs failed (historical)

Treating drips as spheres under a rigid/soft mesh produced floating orbs and discontinuous necks — **opposite** of concept art continuous letter→pendant. Soft-letter + `DripSim` lip tracking was an interim fix; the correction is to **delete the blob path from the default look** and sag the letter itself.

---

## 5c. Frozen viscoplastic mesh sag (2026-07 rethink) — CURRENT

**Right approach:** the **letter mesh itself** is attracted by gravity. Upper band is a rigid plug (freeze height); yielded bottoms stretch into continuous neck/bulb; result **freezes** (one-shot or KE settle). No detach-and-fall particle drips as the main look.

**Yield mask + target (`GravityMeltSim`):**

\[
w(h)=0\ (h\ge h_f),\quad
w(h)=\bigl((h_f-h)/h_f\bigr)^{p}\ (h<h_f)
\]

Target: \(\Delta y = -\mathrm{sagAmp}\cdot w\cdot(\ldots)\); mid-band radial **neck pinch**; tip **bulb grow** along stem columns.

Optional Verlet mode attracts toward that target until KE < `freezeKe`, then freeze. Default scratch path is **oneShot** ease → freeze.

**Implementation (scratch `demo/scratch.html`):**
1. Bind GLB buffers to `GravityMeltSim` — **one mesh slot per glyph**
2. Stage 5: master Gravity / Freeze ht / Viscosity / Sag / Bulb-soft + **per-letter** enable & overrides (click glyph or picker)
3. Font picker swaps pre-baked `wordmark-*.glb` (Blender portable bake)
4. Roundness: cosine/pear teardrop radial + softMin bulb SDF tip overlay + tip-boosted Taubin on yielded verts
5. Pendant sphere pool **removed** — `dripBlobs: 0`
6. `DripSim` for **2D field / glassify** only
7. Honey look: high viscosity defaults (~0.78), tip-heavy hang, narrow drip columns, per-letter bulb boosts on `k`/`p`
8. **`sculptHoneyPendant` post-pass** — per-column remap of yielded verts onto parametric neck→bulb→tip-taper (absolute radii from `colW`, not full glyph width). Caps hang so tips stay mid-air; floor dropped in scratch demo.

**Per-letter API:**

```ts
meltSim.setLetterOverrides([
  { enable: true, sagAmpMul: 1.2, viscosity: 0.6 },
  { enable: false }, // identity / frozen letter
  { intensity: 0.4, freezeHeight: 0.7, bulbGrowMul: 1.5 },
]);
```

Missing fields inherit master defaults. `enable: false` keeps the glyph at rest pose.

**Literature (frozen / yield / hanging):**

| Work | Year | Steal |
|------|------|-------|
| Balmforth, Frigaard, Ovarlez — *Yielding to stress* (Annu. Rev. Fluid Mech.) | 2014 | Yield → rigid plugs; free-surface slumps **stop** |
| Balmforth & Hewitt — *Viscoplastic sheets and threads* | 2013 | Drooping threads → **steady frozen shapes** |
| Teichman & Mahadevan — *The viscous catenary* (JFM) | 2003 | Hanging viscous filament under \(g\) |
| Le Merrer et al. — hanging viscous filaments (EPL) | 2008 | Catenary vs U-shape; viscosity sets time |
| Koulakis / Mitescu — viscous catenary experiments | 2007–08 | Lab hang morphology |
| German & Bertola — viscoplastic pendant failure | 2010 | Yield-stress pendant limits |
| van der Kolk et al. — viscoplastic printed filaments (JFM) | 2023 | Filaments reach **final equilibrium** at yield |
| de Souza Mendes & Thompson — elasto-viscoplastic thixotropy | 2013 | Structured fluids that solidify after flow |
| Soft Matter Oh review / JFM soft-substrate papers | 2021–23 | Oh scaling; soft interface drainage |
| Concept art `klaut.pro/concept_art/*.jpg` | 2026 | Continuous solidified pendants |

Not adopting MLS-MPM for logo melt. Production look = **freeze-masked mesh sag + one-shot freeze**.

---

## 6. Citation quick list

| # | Work | Year | Takeaway |
|---|------|------|----------|
| 1 | Brackbill et al., CSF | 1992 | Continuum ST (pane path) |
| 2 | Teichman & Mahadevan, viscous catenary | 2003 | Hanging viscous filament |
| 3 | Balmforth & Hewitt, viscoplastic sheets/threads | 2013 | Yield → frozen droop equilibria |
| 4 | Balmforth et al., Annu. Rev. yield-stress | 2014 | Plugs + stopped slumps |
| 5 | Le Merrer et al., hanging filaments | 2008 | Shape selection under gravity |
| 6 | van der Kolk et al., viscoplastic lines | 2023 | Print filaments freeze at yield |
| 7 | Da et al., Surface-Only Liquids | 2016 | Mesh drip morphology reference |
| 8 | Stomakhin et al., Weta drips | 2019 | Film drips — not logo default |
| 9 | Quilez / Codrops metaballs | — | Field merge (pane only) |
| 10 | KRÜSS pendant-drop docs | — | Static pear silhouette |
| 11 | In-repo `GravityMeltSim.ts` | 2026 | Frozen mesh sag + freeze-height |
| 12 | In-repo `DripSim.ts` | 2026 | Optional continuum pane emitters |
| 13 | Concept art `klaut.pro/concept_art` | 2026 | Visual north star |

---

## 7. Decision lock

For the **klaut.pro glass wordmark**: ship **Rank 1 frozen viscoplastic mesh sag** (`GravityMeltSim`: freeze-height mask, pendant neck/bulb, one-shot settle → freeze). Do **not** attach drop blobs to letters for the default brand look.

For **2D glassify / SDF panes**: keep `DripSim` + softMin. MLS-MPM remains optional WebGPU showcase only.
