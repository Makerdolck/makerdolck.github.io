import React, { useEffect, useRef } from "react";

/**
 * GooAura — lofi glow‑blob with center-biased blobs and per‑blob star rays
 * - Super‑smooth motion, slow hue cycling
 * - Blobs prefer the center (controllable), star/rays emanate from each blob
 * - HiDPI & responsive, pointer influence is gently eased
 *
 * Usage: <GooAura className="w-full h-[520px] rounded-2xl" />
 *
 * Props (optional):
 *   speed       — base animation speed multiplier (default 0.6)
 *   spikes      — overall rays intensity [0..1] (default 0.25)
 *   blobs       — gaussian blobs [3..7] (default 5)
 *   hueSpeed    — hue rotation speed in rad/s (default 0.05)
 *   centerPull  — how much blobs stay near center [0..1] (default 0.65)
 */
export default function GooAura({
  className = "w-full h-[520px] rounded-2xl",
  speed = 0.6,
  spikes = 0.25,
  blobs = 5,
  hueSpeed = 0.05,
  centerPull = 0.65,
}) {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const seedRef = useRef(Math.random() * 1000);

  // pointer smoothing (lofi): target vs. eased position
  const mouseTargetRef = useRef([0, 0]);
  const mouseSmoothRef = useRef([0, 0]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) {
      // graceful Canvas2D fallback
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const drawFallback = () => {
          const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          const w = canvas.clientWidth * dpr;
          const h = canvas.clientHeight * dpr;
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
          const cx = w * 0.5, cy = h * 0.5, r = Math.min(w, h) * 0.28;
          const g = ctx.createRadialGradient(cx, cy, r*0.1, cx, cy, r*1.8);
          g.addColorStop(0, "#ffd400"); g.addColorStop(0.55, "#ff7a00"); g.addColorStop(0.75, "#d400a6"); g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < 5; i++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(((performance.now()/1000)*0.12 + i) % (Math.PI*2));
            ctx.translate(Math.cos(i)*r*0.18, Math.sin(i)*r*0.18);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
            ctx.restore();
          }
          requestAnimationFrame(drawFallback);
        };
        drawFallback();
      }
      return;
    }
    glRef.current = gl;

    // --- Shaders ---
    const vert = `
      attribute vec2 a_position;
      varying vec2 v_pos;
      void main(){
        v_pos = a_position; // clipspace [-1,1]
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const frag = `
      precision highp float;
      varying vec2 v_pos;
      uniform vec2  u_res;      // canvas size in pixels
      uniform float u_time;     // seconds
      uniform vec2  u_mouse;    // normalized [-1,1]
      uniform float u_speed;
      uniform float u_spikes;   // 0..1
      uniform float u_seed;
      uniform float u_blobCount; // 3..7 (rounded in shader)
      uniform float u_hue;      // hue rotation angle
      uniform float u_centerPull;// 0..1, pull blobs toward center

      // hue rotation matrix (approx.)
      vec3 hueRotate(vec3 color, float a){
        float U = cos(a);
        float W = sin(a);
        mat3 m = mat3(
          0.299 + 0.701*U + 0.168*W, 0.587 - 0.587*U + 0.330*W, 0.114 - 0.114*U - 0.497*W,
          0.299 - 0.299*U - 0.328*W, 0.587 + 0.413*U + 0.035*W, 0.114 - 0.114*U + 0.292*W,
          0.299 - 0.300*U + 1.250*W, 0.587 - 0.588*U - 1.050*W, 0.114 + 0.886*U - 0.203*W
        );
        return clamp(m * color, 0.0, 1.0);
      }

      // 2D rotation
      mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c,-s,s,c); }

      // gaussian falloff
      float gauss(vec2 p, float s){ return exp(-dot(p,p) / (2.0*s*s)); }

      // calm palette
      vec3 palette(float t){
        t = clamp(t, 0.0, 1.0);
        vec3 black  = vec3(0.0);
        vec3 purple = vec3(0.42, 0.00, 0.36);
        vec3 magenta= vec3(0.92, 0.00, 0.62);
        vec3 orange = vec3(1.00, 0.52, 0.00);
        vec3 yellow = vec3(1.00, 0.90, 0.00);
        vec3 green  = vec3(0.12, 0.78, 0.24);

        vec3 col = mix(black,  purple, smoothstep(0.06, 0.38, t));
        col = mix(col, magenta, smoothstep(0.26, 0.58, t));
        col = mix(col, orange,  smoothstep(0.48, 0.78, t));
        col = mix(col, yellow,  smoothstep(0.62, 0.99, t));
        float rim = smoothstep(0.34, 0.62, t) * (1.0 - smoothstep(0.70, 0.92, t));
        float topBias = smoothstep(-0.1, 0.6, v_pos.y);
        col += green * rim * topBias * 0.5;
        return col;
      }

      void main(){
        float aspect = u_res.x / u_res.y;
        vec2 uv = v_pos;  // [-1,1]
        uv.x *= aspect;

        float t = u_time * (0.32 + 0.60*u_speed); // calm
        float seed = u_seed;

        // Gentle space warp for organic feel
        vec2 w = uv;
        w += 0.045*vec2(sin(uv.y*1.9 + t*0.40 + seed), cos(uv.x*1.8 - t*0.34 + seed));
        w *= rot(0.055*sin(t*0.16));

        // Center anchor softly brightens the middle area (helps focus)
        float v = gauss(w, 0.34) * 0.10;

        float count = clamp(u_blobCount, 3.0, 7.0);
        float ampBase = 0.28;                         // base orbital radius
        float amp     = ampBase * mix(1.0, 0.45, u_centerPull); // pull toward center

        // Per-blob contributions and per-blob star rays
        for (int i=0;i<7;i++){
          if(float(i) >= count) break;
          float fi = float(i);
          // compact circular drift near center
          vec2 c = amp * vec2(
            sin(t*(0.35 + 0.06*fi) + seed + fi*1.7),
            cos(t*(0.39 - 0.05*fi) + seed*1.3 + fi*0.9)
          );
          c.x *= aspect;
          float s = 0.27 + 0.035*sin(t*0.45 + fi*1.7 + seed);

          // gaussian glow
          float g = gauss(w - c, s) * (0.95 - 0.12*fi);
          v += g;

          // dynamic rays emanating from this blob
          vec2  rp = w - c;                 // pixel relative to blob center
          float ang = atan(rp.y, rp.x);
          float rad = length(rp);
          float n   = mix(4.0, 10.0, 0.5 + 0.5*sin(t*0.22 + fi*0.8 + seed)); // variable count
          float ph  = sin(t*(0.12 + 0.03*fi) + seed*1.1 + fi);              // slow rotation
          float spokes = pow(max(0.0, cos(n*ang + ph)), 14.0);
          float flare  = spokes * exp(-rad*4.8) * u_spikes * (1.1 - 0.12*fi);
          v += flare;
        }

        // Pointer attraction (very subtle)
        vec2 m = vec2(u_mouse.x*aspect, u_mouse.y);
        v += gauss(w - m*0.55, 0.28) * 0.12;

        // normalize & contrast shaping
        v = clamp(v, 0.0, 1.0);
        v = pow(v, 0.94 + 0.05*sin(t*0.18));

        vec3 col = palette(v);
        col = hueRotate(col, u_hue); // slow color cycle

        // gentle vignette
        float vig = smoothstep(1.22, 0.56, length(uv));
        col *= vig;

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        gl.deleteShader(s); return null;
      }
      return s;
    };

    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const vertices = new Float32Array([
      -1, -1,   1, -1,   -1,  1,
      -1,  1,   1, -1,    1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // Uniforms
    const uRes    = gl.getUniformLocation(program, "u_res");
    const uTime   = gl.getUniformLocation(program, "u_time");
    const uMouse  = gl.getUniformLocation(program, "u_mouse");
    const uSpeed  = gl.getUniformLocation(program, "u_speed");
    const uSpikes = gl.getUniformLocation(program, "u_spikes");
    const uSeed   = gl.getUniformLocation(program, "u_seed");
    const uBlobCt = gl.getUniformLocation(program, "u_blobCount");
    const uHue    = gl.getUniformLocation(program, "u_hue");
    const uCenter = gl.getUniformLocation(program, "u_centerPull");

    const fit = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      const W = Math.floor(w * dpr), H = Math.floor(h * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const onPointer = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((rect.height - (e.clientY - rect.top)) / rect.height) * 2 - 1;
      mouseTargetRef.current = [x, y];
    };

    const onClick = () => { seedRef.current = Math.random() * 1000; };

    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("click", onClick);
    window.addEventListener("resize", fit);
    fit();

    const render = (now) => {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;

      // smooth pointer easing (exponential)
      const [tx, ty] = mouseTargetRef.current;
      const [sx, sy] = mouseSmoothRef.current;
      const easedX = sx + (tx - sx) * 0.04;
      const easedY = sy + (ty - sy) * 0.04;
      mouseSmoothRef.current = [easedX, easedY];

      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, easedX, easedY);
      gl.uniform1f(uSpeed, speed);
      gl.uniform1f(uSpikes, spikes);
      gl.uniform1f(uSeed, seedRef.current);
      gl.uniform1f(uBlobCt, blobs);
      gl.uniform1f(uHue, t * hueSpeed);
      gl.uniform1f(uCenter, centerPull);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafRef.current = requestAnimationFrame(render);
    };

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
      } else {
        startRef.current = performance.now();
        rafRef.current = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", fit);
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("click", onClick);
      // cleanup GL resources
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
    };
  }, [speed, spikes, blobs, hueSpeed, centerPull]);

  return (
    <div className={`relative bg-black ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full rounded-2xl" />
    </div>
  );
}
