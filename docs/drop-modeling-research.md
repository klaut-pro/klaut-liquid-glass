# Drop Modeling Research — klaut-liquid-glass

Deep dive on how to model **viscosity-dependent pendant drips** for the klaut.pro glass wordmark / field engine. Sources: public papers, VFX talks, WebGL/WebGPU demos, Codrops/Shadertoy prior art, and in-repo engine notes (`DripSim.ts`, `docs/liquid-glass-research.md`, liquid-glass-physics skill).

**Klaut research gateway status:** `klaut-li-research` / `li-research-gateway` is planned (Semantic Scholar + OpenAlex warm index) but not queryable for this pass. `https://search.klaut.pro` currently serves the **lip registry** landing page (wrong vhost / TLS SNI `SEC_E_WRONG_PRINCIPAL` when verified); Majico `web_search` (SearXNG/Klaut/Serper chain) returned empty rows. Findings below use WebSearch + direct paper/article fetches instead.

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

`DripSim` is explicitly a **practical continuum proxy** (not SPH):

1. Mass accumulates at bottom emitters (Bond-ish critical mass).
2. Stretch forms a neck; viscosity ↑ → longer / slower neck.
3. Detach when neck thins → free drops + drag.
4. Remerge nearby frees; shader `smoothMin` blends blobs into pane/glyph field.

Scratch demo (`demo/scratch.html`) approximates stage-5 with Three.js spheres/capsules driven by the same viscosity mapping for orbit QA on the baked wordmark mesh.

---

## 4. Ranked recommendations for klaut.pro mesh drips

### ★ Rank 1 — Hybrid continuum emitters + SDF / mesh softMin (ship / deepen)

**Pipeline:**

1. Sample **drip emitters** along the wordmark medial bottom (per-glyph stem lips for `k`,`l`,`a`,`u`,`t`,`.`,`p`,`r`,`o` — or auto along AABB bottom silhouette).
2. CPU (or tiny compute) **fill → stretch → pinch → free** with Oh/Bo-inspired maps from UI `viscosity` / `drip` / `liquify`.
3. Upload ≤48 blobs + optional capsule endpoints; merge with mesh/glyph field via `smoothMin` (2D field for glassify, or vertex liquify + pendant meshes for scratch GLB).
4. Shade with existing glass IOR / Fresnel / dispersion — drips inherit liquid material.

**Why #1:** Matches engine architecture, WebGL2, ≤3 live surfaces budget, readable brand type, already partially implemented. Steal CSF/RP *semantics* without SPH cost.

**Next upgrades:**
- Neck radius from Quilez capsule SDF, not only blob weights.
- Detach threshold ∝ \(1/\mathrm{Oh}\) (viscosity delays pinch).
- Emitters from mesh bottom edge samples of `wordmark-klaut-pro.glb`.

### ★ Rank 2 — Screen-space / field-only liquify with procedural pendants (no particle sim)

Keep the GLB glass wordmark; drive drips as **shader-only** SDF pendants (time + viscosity uniforms) seeded under letter bottoms. Optional: march a few spheres in a second pass.

**Why #2:** Cheapest realtime; great for landing loops. Weaker physical continuity (no true mass conservation) but excellent brand readability.

Steal: Codrops metaball trail / Quilez smin; Weta contact-angle idea as “stick to underside until stretch exceeds threshold”.

### ★ Rank 3 — WebGPU MLS-MPM island (optional hero demo)

Isolate a small particle volume under the wordmark (or full WaterBall-style toy) with MLS-MPM + SSFR or mesh skinning. Gate behind WebGPU + reduced particle count (~10–30k).

**Why #3:** Best physical splash / breakup fidelity in-browser, but diverges from refractive glass wordmark pipeline, needs WebGPU, and fights “readable klaut.pro” unless heavily constrained (emit only from letter lips, high viscosity, low We).

Defer until Rank 1 looks locked on the scratch + glassify paths.

### Not recommended as primary for logo drips

| Approach | Why skip as default |
|----------|---------------------|
| Full SPH in WebGL2 | Neighbor search / stability cost vs visual gain |
| Offline FLIP (Weta-scale) | Overnight / mm voxels — bake B-roll only |
| Pure vertex jelly without necks | Melty soup, no Rayleigh–Plateau read |

---

## 5. Practical WebGL pipeline (target)

```
Blender bake: Arial Black "klaut.pro" → wordmark-klaut-pro.glb
        ↓
Three.js MeshPhysicalMaterial glass (scratch)  |  Engine SDF glassify (product)
        ↓
Viscosity UI → Oh-like maps (rate, neck length, tip R, softMin k)
        ↓
Emitters on letter bottoms → DripSim phases
        ↓
Blobs/capsules → smoothMin into field OR pendant meshes under GLB
        ↓
Glass shade (Snell / Fresnel / thin-film) — same material family
```

**Viscosity cheat sheet (keep):**

| viscosity | stretch | speed | softMin k | look |
|-----------|---------|-------|-----------|------|
| low (~0.1) | long | fast | small | watery pinch, satellites |
| mid (~0.45) | medium | mid | mid | default syrup glass |
| high (~0.9) | short | slow | large | honey bulbs, delayed detach |

---

## 6. Citation quick list

| # | Work | Year | Takeaway |
|---|------|------|----------|
| 1 | Brackbill et al., CSF | 1992 | Continuum ST as volume force / curvature |
| 2 | Müller et al., SPH SCA | 2003 | Interactive particle NS + ST term |
| 3 | Wang et al., Water Drops on Surfaces | 2005 | SDF curvature ST + contact angle |
| 4 | Hu et al., MLS-MPM | 2018 | Realtime hybrid particles without neighbors |
| 5 | Stomakhin et al., Weta drips talk | 2019 | FLIP + viscosity band + adhesion for film drips |
| 6 | Da et al., Surface-Only Liquids | 2016 | Mesh BEM drip pinch / RP morphology |
| 7 | Szewc et al., SPH Rayleigh–Plateau | 2018 | Ligament breakup resolution notes |
| 8 | Quilez smin / Codrops metaballs | 2010s–2025 | Real-time liquid merge look |
| 9 | Matsuoka Codrops WebGPU fluids | 2025 | MLS-MPM + SSFR browser ceiling |
| 10 | KRÜSS / tensiometry docs | — | Pendant morphology ↔ σ, g |
| 11 | In-repo `DripSim.ts` + liquid-glass-research.md | 2026 | Our locked continuum + softMin stack |

---

## 7. Decision lock

For **viscosity-dependent drips on the klaut.pro glass wordmark**, deepen **Rank 1** (continuum emitters + softMin / capsule necks). Use Rank 2 for ultra-cheap landing loops. Treat Rank 3 (MLS-MPM) as an optional WebGPU showcase, not the production glassify path.
