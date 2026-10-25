/**
 * GPU upscaler (WebGL2) for animated backgrounds: xBR level 2 (Hyllian's algorithm, the same family
 * as xBRZ), evaluated per output pixel in a fragment shader, so it runs every frame at no CPU cost.
 * Static screens keep using the (slightly better) cached CPU xBRZ.
 */
const VS = `#version 300 es
in vec2 pos;
out vec2 vTex;
void main() {
  vTex = pos * 0.5 + 0.5;
  vTex.y = 1.0 - vTex.y;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 size;
in vec2 vTex;
out vec4 outColor;

const float coef = 2.0;
const vec4 eq_threshold = vec4(15.0);
const vec3 Yw = 48.0 * vec3(0.299, 0.587, 0.114);
const vec4 Ao = vec4( 1.0, -1.0, -1.0, 1.0);
const vec4 Bo = vec4( 1.0,  1.0, -1.0,-1.0);
const vec4 Co = vec4( 1.5,  0.5, -0.5, 0.5);
const vec4 Ax = vec4( 1.0, -1.0, -1.0, 1.0);
const vec4 Bx = vec4( 0.5,  2.0, -0.5,-2.0);
const vec4 Cx = vec4( 1.0,  1.0, -0.5, 0.0);
const vec4 Ay = vec4( 1.0, -1.0, -1.0, 1.0);
const vec4 By = vec4( 2.0,  0.5, -2.0,-0.5);
const vec4 Cy = vec4( 2.0,  0.0, -1.0, 0.5);
const vec4 Ci = vec4(0.25);

vec3 T(vec2 p) { return texture(src, p).rgb; }
vec4 lum(vec3 a, vec3 b, vec3 c, vec3 d) { return vec4(dot(a, Yw), dot(b, Yw), dot(c, Yw), dot(d, Yw)); }
vec4 df(vec4 a, vec4 b) { return abs(a - b); }
float cdf(vec3 a, vec3 b) { vec3 d = abs(a - b); return d.r + d.g + d.b; }
vec4 eqv(vec4 a, vec4 b) { return vec4(lessThan(df(a, b), eq_threshold)); }
vec4 nev(vec4 a, vec4 b) { return vec4(notEqual(a, b)); }
vec4 wdist(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h) {
  return df(a, b) + df(a, c) + df(d, e) + df(d, f) + 4.0 * df(g, h);
}

void main() {
  vec2 ps = 1.0 / size;
  vec2 fp = fract(vTex * size);
  vec2 tc = (floor(vTex * size) + 0.5) * ps;
  float dx = ps.x, dy = ps.y;
  //    A1 B1 C1
  // A0  A  B  C C4
  // D0  D  E  F F4
  // G0  G  H  I I4
  //    G5 H5 I5
  vec3 A1 = T(tc + vec2(-dx, -2.0*dy)), B1 = T(tc + vec2(0.0, -2.0*dy)), C1 = T(tc + vec2(dx, -2.0*dy));
  vec3 A  = T(tc + vec2(-dx, -dy)),     B  = T(tc + vec2(0.0, -dy)),     C  = T(tc + vec2(dx, -dy));
  vec3 D  = T(tc + vec2(-dx, 0.0)),     E  = T(tc),                       F  = T(tc + vec2(dx, 0.0));
  vec3 G  = T(tc + vec2(-dx, dy)),      H  = T(tc + vec2(0.0, dy)),      I  = T(tc + vec2(dx, dy));
  vec3 G5 = T(tc + vec2(-dx, 2.0*dy)),  H5 = T(tc + vec2(0.0, 2.0*dy)),  I5 = T(tc + vec2(dx, 2.0*dy));
  vec3 A0 = T(tc + vec2(-2.0*dx, -dy)), D0 = T(tc + vec2(-2.0*dx, 0.0)), G0 = T(tc + vec2(-2.0*dx, dy));
  vec3 C4 = T(tc + vec2(2.0*dx, -dy)),  F4 = T(tc + vec2(2.0*dx, 0.0)),  I4 = T(tc + vec2(2.0*dx, dy));

  vec4 b = lum(B, D, H, F);
  vec4 c = lum(C, A, G, I);
  vec4 e = lum(E, E, E, E);
  vec4 d = b.yzwx;
  vec4 f = b.wxyz;
  vec4 g = c.zwxy;
  vec4 h = b.zwxy;
  vec4 i = c.wxyz;
  vec4 i4 = lum(I4, C1, A0, G5);
  vec4 i5 = lum(I5, C4, A1, G0);
  vec4 h5 = lum(H5, F4, B1, D0);
  vec4 f4 = h5.yzwx;

  vec4 fx      = Ao * fp.y + Bo * fp.x;
  vec4 fx_left = Ax * fp.y + Bx * fp.x;
  vec4 fx_up   = Ay * fp.y + By * fp.x;

  vec4 r_lv0 = nev(e, f) * nev(e, h);
  // corner type B
  vec4 r_lv1 = r_lv0 * clamp(
      (1.0 - eqv(f, b)) * (1.0 - eqv(h, d))
    + eqv(e, i) * (1.0 - eqv(f, i4)) * (1.0 - eqv(h, i5))
    + eqv(e, g) + eqv(e, c), 0.0, 1.0);
  vec4 r_lv2_left = nev(e, g) * nev(d, g);
  vec4 r_lv2_up   = nev(e, c) * nev(b, c);

  vec4 delta = vec4(0.25); // edge antialiasing width, about one output pixel at 4x
  vec4 fx45i = clamp((fx      + delta - Co - Ci) / (2.0 * delta), 0.0, 1.0);
  vec4 fx45  = clamp((fx      + delta - Co)      / (2.0 * delta), 0.0, 1.0);
  vec4 fx30  = clamp((fx_left + delta - Cx)      / (2.0 * delta), 0.0, 1.0);
  vec4 fx60  = clamp((fx_up   + delta - Cy)      / (2.0 * delta), 0.0, 1.0);

  vec4 wd1 = wdist(e, c, g, i, h5, f4, h, f);
  vec4 wd2 = wdist(h, d, i5, f, i4, b, e, i);

  vec4 edri     = vec4(lessThanEqual(wd1, wd2)) * r_lv0;
  vec4 edr      = vec4(lessThan(wd1, wd2)) * r_lv1;
  vec4 edr_left = vec4(lessThanEqual(coef * df(f, g), df(h, c))) * r_lv2_left * edr;
  vec4 edr_up   = vec4(greaterThanEqual(df(f, g), coef * df(h, c))) * r_lv2_up * edr;

  fx45  *= edr;
  fx30  *= edr_left;
  fx60  *= edr_up;
  fx45i *= edri;

  vec4 px = vec4(lessThanEqual(df(e, f), df(e, h)));
  vec4 m = max(max(fx30, fx60), max(fx45, fx45i));

  vec3 res1 = mix(E, px.x > 0.5 ? F : H, m.x);
  res1 = mix(res1, px.z > 0.5 ? D : B, m.z);
  vec3 res2 = mix(E, px.y > 0.5 ? B : F, m.y);
  res2 = mix(res2, px.w > 0.5 ? H : D, m.w);
  vec3 res = mix(res1, res2, step(cdf(E, res1), cdf(E, res2)));
  outColor = vec4(res, 1.0);
}`;

export class XbrGL {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  private uSize: WebGLUniformLocation;

  constructor(private w: number, private h: number, scale: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w * scale;
    this.canvas.height = h * scale;
    const gl = this.canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.uSize = gl.getUniformLocation(prog, "size")!;
    gl.uniform2f(this.uSize, w, h);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Upscale an RGBA image (w*h*4 bytes); the result is in `canvas`. */
  render(rgba: Uint8Array) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
