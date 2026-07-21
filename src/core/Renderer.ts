import {

  createProgram,

  createTexture,

  prefersReducedMotion,

  uploadTexture,

} from "./gl.js";

import { FRAG_SRC, SHADER_MAX_BLOBS, VERT_SRC } from "../shade/shaders.js";

import type { Material } from "../api/Material.js";

import type { DripBlob } from "../field/DripSim.js";

import {

  getGlyphAtlasMeta,

  loadGlyphAtlasImage,

} from "../field/GlyphAtlasRuntime.js";

import type { GlyphId } from "../field/GlyphProfiles.js";



export type SurfaceUniforms = Material & {

  time: number;

  reducedMotion: number;

  blobs?: DripBlob[];

  fieldMode?: "pane" | "glyph";

  glyphId?: GlyphId;

};



export class Renderer {

  readonly canvas: HTMLCanvasElement;

  readonly gl: WebGL2RenderingContext;

  private program: WebGLProgram;

  private vao: WebGLVertexArrayObject;

  private backdropTex: WebGLTexture;

  private glyphTexChrome: WebGLTexture;

  private glyphTexScript: WebGLTexture;

  private glyphReady = { chromeSansP: false, scriptProP: false };

  private locs: Record<string, WebGLUniformLocation | null>;

  private blobLocs: (WebGLUniformLocation | null)[] = [];

  private disposed = false;

  private atlasLoad: Promise<void>;



  constructor(canvas: HTMLCanvasElement) {

    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", {

      alpha: true,

      premultipliedAlpha: true,

      antialias: false,

      preserveDrawingBuffer: true, // allow hyperframe / screenshot capture

    });

    if (!gl) throw new Error("WebGL2 unavailable");

    this.gl = gl;

    this.program = createProgram(gl, VERT_SRC, FRAG_SRC);

    this.vao = this.createQuad();

    this.backdropTex = createTexture(gl);

    this.glyphTexChrome = createTexture(gl);

    this.glyphTexScript = createTexture(gl);

    this.locs = this.cacheLocations();

    this.atlasLoad = this.warmGlyphAtlases();

  }



  /** Promise that resolves once font-baked SDF atlases are on the GPU. */

  whenAtlasesReady(): Promise<void> {

    return this.atlasLoad;

  }



  private async warmGlyphAtlases(): Promise<void> {

    try {

      const [chromeImg, scriptImg] = await Promise.all([

        loadGlyphAtlasImage("chromeSansP"),

        loadGlyphAtlasImage("scriptProP"),

      ]);

      if (this.disposed) return;

      this.uploadGlyphAtlas(this.glyphTexChrome, chromeImg);

      this.uploadGlyphAtlas(this.glyphTexScript, scriptImg);

      this.glyphReady.chromeSansP = true;

      this.glyphReady.scriptProP = true;

    } catch (err) {

      console.warn("[liquid-glass] glyph atlas load failed; procedural fallback", err);

    }

  }



  private uploadGlyphAtlas(tex: WebGLTexture, source: TexImageSource): void {

    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, tex);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

  }



  private createQuad(): WebGLVertexArrayObject {

    const gl = this.gl;

    const vao = gl.createVertexArray();

    if (!vao) throw new Error("VAO failed");

    gl.bindVertexArray(vao);

    const buf = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, buf);

    gl.bufferData(

      gl.ARRAY_BUFFER,

      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),

      gl.STATIC_DRAW,

    );

    gl.enableVertexAttribArray(0);

    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    return vao;

  }



  private cacheLocations(): Record<string, WebGLUniformLocation | null> {

    const gl = this.gl;

    const names = [

      "u_backdrop",

      "u_glyphSdf",

      "u_resolution",

      "u_time",

      "u_glass",

      "u_liquify",

      "u_drip",

      "u_viscosity",

      "u_dispersion",

      "u_filmThickness",

      "u_ior",

      "u_bevel",

      "u_blur",

      "u_cornerRadius",

      "u_specular",

      "u_reducedMotion",

      "u_lightPos",

      "u_lightIntensity",

      "u_blobCount",

      "u_fieldMode",

      "u_glyphId",

      "u_useGlyphAtlas",

      "u_glyphSdfScale",

      "u_glyphExtent",

    ];

    const out: Record<string, WebGLUniformLocation | null> = {};

    for (const n of names) out[n] = gl.getUniformLocation(this.program, n);

    this.blobLocs = [];

    for (let i = 0; i < SHADER_MAX_BLOBS; i++) {

      this.blobLocs.push(gl.getUniformLocation(this.program, `u_blobs[${i}]`));

    }

    return out;

  }



  resize(cssWidth: number, cssHeight: number, dpr = Math.min(devicePixelRatio || 1, 2)): void {

    const w = Math.max(1, Math.round(cssWidth * dpr));

    const h = Math.max(1, Math.round(cssHeight * dpr));

    if (this.canvas.width !== w || this.canvas.height !== h) {

      this.canvas.width = w;

      this.canvas.height = h;

    }

    this.canvas.style.width = `${cssWidth}px`;

    this.canvas.style.height = `${cssHeight}px`;

  }



  /**

   * Upload backdrop only when dimensions change or caller forces.

   * Avoids mid-frame blanking — critical for flicker-free recapture.

   */

  setBackdrop(source: TexImageSource, _force = false): void {

    void _force;

    uploadTexture(this.gl, this.backdropTex, source);

  }



  draw(u: SurfaceUniforms): void {

    if (this.disposed) return;

    const gl = this.gl;

    const { width, height } = this.canvas;

    if (width < 1 || height < 1) return;



    gl.viewport(0, 0, width, height);

    gl.clearColor(0, 0, 0, 0);

    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);



    gl.useProgram(this.program);

    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);

    gl.bindTexture(gl.TEXTURE_2D, this.backdropTex);

    gl.uniform1i(this.locs.u_backdrop, 0);



    const glyphId = u.glyphId ?? "chromeSansP";

    const atlasReady =

      u.fieldMode === "glyph" &&

      (glyphId === "scriptProP" ? this.glyphReady.scriptProP : this.glyphReady.chromeSansP);

    const glyphTex =

      glyphId === "scriptProP" ? this.glyphTexScript : this.glyphTexChrome;

    gl.activeTexture(gl.TEXTURE1);

    gl.bindTexture(gl.TEXTURE_2D, glyphTex);

    gl.uniform1i(this.locs.u_glyphSdf, 1);



    if (atlasReady) {

      const meta = getGlyphAtlasMeta(glyphId);

      gl.uniform1f(this.locs.u_useGlyphAtlas, 1);

      gl.uniform1f(this.locs.u_glyphSdfScale, meta.maxDist);

      gl.uniform1f(this.locs.u_glyphExtent, meta.fieldExtent);

    } else {

      gl.uniform1f(this.locs.u_useGlyphAtlas, 0);

      gl.uniform1f(this.locs.u_glyphSdfScale, 0.1);

      gl.uniform1f(this.locs.u_glyphExtent, 0.55);

    }



    gl.uniform2f(this.locs.u_resolution, width, height);

    gl.uniform1f(this.locs.u_time, u.time);

    gl.uniform1f(this.locs.u_glass, u.glass);

    gl.uniform1f(this.locs.u_liquify, u.liquify);

    gl.uniform1f(this.locs.u_drip, u.drip);

    gl.uniform1f(this.locs.u_viscosity, u.viscosity);

    gl.uniform1f(this.locs.u_dispersion, u.dispersion);

    gl.uniform1f(this.locs.u_filmThickness, u.filmThickness);

    gl.uniform1f(this.locs.u_ior, u.ior);

    gl.uniform1f(this.locs.u_bevel, u.bevel);

    gl.uniform1f(this.locs.u_blur, u.blur);

    gl.uniform1f(this.locs.u_cornerRadius, u.cornerRadius);

    gl.uniform1f(this.locs.u_specular, u.specular);

    gl.uniform1f(this.locs.u_reducedMotion, u.reducedMotion);

    const lp = u.lightPosition;

    gl.uniform3f(this.locs.u_lightPos, lp.x, lp.y, lp.z);

    gl.uniform1f(this.locs.u_lightIntensity, u.lightIntensity);



    const blobs = u.blobs ?? [];

    const count = Math.min(blobs.length, SHADER_MAX_BLOBS);

    gl.uniform1i(this.locs.u_blobCount, count);

    gl.uniform1f(this.locs.u_fieldMode, u.fieldMode === "glyph" ? 1 : 0);

    gl.uniform1f(this.locs.u_glyphId, u.glyphId === "scriptProP" ? 1 : 0);

    for (let i = 0; i < SHADER_MAX_BLOBS; i++) {

      const loc = this.blobLocs[i];

      if (!loc) continue;

      if (i < count) {

        const b = blobs[i];

        gl.uniform4f(loc, b.x, b.y, b.r, b.w);

      } else {

        gl.uniform4f(loc, 0, 0, 0, 0);

      }

    }



    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindVertexArray(null);

  }



  /** PNG data URL of current framebuffer (composited on dark studio plate). */
  captureFrame(): string {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w < 1 || h < 1) return this.canvas.toDataURL("image/png");

    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    if (!ctx) return this.canvas.toDataURL("image/png");

    // Dark studio plate (matches glyph QA stage)
    ctx.fillStyle = "#08080a";
    ctx.fillRect(0, 0, w, h);

    const img = ctx.createImageData(w, h);
    // WebGL readPixels is bottom-up; flip Y and composite premultiplied over dark plate.
    // SwiftShader sometimes returns opaque white for cleared texels — treat as empty.
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4;
      const dstRow = y * w * 4;
      for (let x = 0; x < w; x++) {
        const i = srcRow + x * 4;
        const j = dstRow + x * 4;
        let a = pixels[i + 3] / 255;
        let pr = pixels[i] / 255;
        let pg = pixels[i + 1] / 255;
        let pb = pixels[i + 2] / 255;
        const luma = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
        if (a > 0.98 && luma > 0.92) {
          a = 0;
          pr = pg = pb = 0;
        }
        const br = 8 / 255;
        const bg = 8 / 255;
        const bb = 10 / 255;
        img.data[j] = Math.min(255, Math.round((pr + br * (1 - a)) * 255));
        img.data[j + 1] = Math.min(255, Math.round((pg + bg * (1 - a)) * 255));
        img.data[j + 2] = Math.min(255, Math.round((pb + bb * (1 - a)) * 255));
        img.data[j + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return off.toDataURL("image/png");
  }



  dispose(): void {

    if (this.disposed) return;

    this.disposed = true;

    const gl = this.gl;

    gl.deleteProgram(this.program);

    gl.deleteTexture(this.backdropTex);

    gl.deleteTexture(this.glyphTexChrome);

    gl.deleteTexture(this.glyphTexScript);

    gl.deleteVertexArray(this.vao);

  }

}



export function motionFrozen(): boolean {

  return prefersReducedMotion();

}


