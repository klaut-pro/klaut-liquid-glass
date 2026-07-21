import {
  createProgram,
  createTexture,
  prefersReducedMotion,
  uploadTexture,
} from "./gl.js";
import { FRAG_SRC, VERT_SRC } from "../shade/shaders.js";
import type { Material } from "../api/Material.js";

export type SurfaceUniforms = Material & {
  time: number;
  reducedMotion: number;
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private backdropTex: WebGLTexture;
  private locs: Record<string, WebGLUniformLocation | null>;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.program = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.vao = this.createQuad();
    this.backdropTex = createTexture(gl);
    this.locs = this.cacheLocations();
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
      "u_resolution",
      "u_time",
      "u_glass",
      "u_liquify",
      "u_drip",
      "u_dispersion",
      "u_filmThickness",
      "u_ior",
      "u_bevel",
      "u_blur",
      "u_cornerRadius",
      "u_specular",
      "u_reducedMotion",
    ];
    const out: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) out[n] = gl.getUniformLocation(this.program, n);
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

  setBackdrop(source: TexImageSource): void {
    uploadTexture(this.gl, this.backdropTex, source);
  }

  draw(u: SurfaceUniforms): void {
    if (this.disposed) return;
    const gl = this.gl;
    const { width, height } = this.canvas;
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
    gl.uniform2f(this.locs.u_resolution, width, height);
    gl.uniform1f(this.locs.u_time, u.time);
    gl.uniform1f(this.locs.u_glass, u.glass);
    gl.uniform1f(this.locs.u_liquify, u.liquify);
    gl.uniform1f(this.locs.u_drip, u.drip);
    gl.uniform1f(this.locs.u_dispersion, u.dispersion);
    gl.uniform1f(this.locs.u_filmThickness, u.filmThickness);
    gl.uniform1f(this.locs.u_ior, u.ior);
    gl.uniform1f(this.locs.u_bevel, u.bevel);
    gl.uniform1f(this.locs.u_blur, u.blur);
    gl.uniform1f(this.locs.u_cornerRadius, u.cornerRadius);
    gl.uniform1f(this.locs.u_specular, u.specular);
    gl.uniform1f(this.locs.u_reducedMotion, u.reducedMotion);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.backdropTex);
    gl.deleteVertexArray(this.vao);
  }
}

export function motionFrozen(): boolean {
  return prefersReducedMotion();
}
