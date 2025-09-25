const { useEffect, useMemo, useRef } = React;

/**
 * GooAura — animated glow-blob that morphs and shifts colors
 * - WebGL fragment shader for buttery-smooth gradients (GPU accelerated)
 * - Responsive, HiDPI-aware, pauses when tab hidden
 * - Interactive: blob subtly follows the pointer; click to randomize motion
 *
 * Usage: GooAura attaches to window. Render via React: <GooAura />
 *
 * Props (optional):
 *   className — optional custom class on container
 *   style    — inline style overrides for outer wrapper
 *   speed    — base animation speed multiplier (default 1)
 *   spikes   — starburst intensity [0..1] (default 0.6)
 *   blobs    — number of gaussian blobs to blend [3..7] (default 5)
 */
function GooAura({ className = "", style = {}, speed = 1, spikes = 0.6, blobs = 5 }) {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const mouseRef = useRef([0, 0]);
  const seedRef = useRef(Math.random() * 1000);

  const containerStyle = useMemo(
    () => ({
      position: "relative",
      width: "100%",
      height: "100%",
      minHeight: "520px",
      backgroundColor: "#000",
      borderRadius: "16px",
      overflow: "hidden",
      ...style,
    }),
    [style]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) {
      // graceful fallback text if WebGL is not available
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const drawFallback = () => {
          const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          const w = canvas.clientWidth * dpr;
          const h = canvas.clientHeight * dpr;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h;
          }
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
          const cx = w * 0.5, cy = h * 0.5, r = Math.min(w, h) * 0.23;
          const g = ctx.createRadialGradient(cx, cy, r*0.1, cx, cy, r*1.6);
          g.addColorStop(0, "#ffd400"); // yellow core
          g.addColorStop(0.55, "#ff7a00");
          g.addColorStop(0.75, "#d400a6"); // magenta
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < 6; i++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(((performance.now()/1000)*0.3 + i) % (Math.PI*2));
            ctx.translate(Math.cos(i)*r*0.25, Math.sin(i)*r*0.25);
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

      // hash helpers
      float hash(float n) { return fract(sin(n)*43758.5453123); }
      float n2(vec2 p){ return fract(43758.5453*sin(dot(p, vec2(127.1,311.7)))); }

      // 2D rotation
      mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c,-s,s,c); }

      // gaussian falloff
      float gauss(vec2 p, float s){ return exp(-dot(p,p) / (2.0*s*s)); }

      // segmented palette roughly matching: black → purple → magenta → orange → yellow → hint of green
      vec3 palette(float t){
        t = clamp(t, 0.0, 1.0);
        vec3 black  = vec3(0.0);
        vec3 purple = vec3(0.45, 0.00, 0.40);
        vec3 magenta= vec3(0.95, 0.00, 0.65);
        vec3 orange = vec3(1.00, 0.56, 0.00);
        vec3 yellow = vec3(1.00, 0.90, 0.00);
        vec3 green  = vec3(0.10, 0.80, 0.20);

        // layered mixes give soft, rich gradients
        vec3 col = mix(black,  purple, smoothstep(0.05, 0.35, t));
        col = mix(col, magenta, smoothstep(0.25, 0.55, t));
        col = mix(col, orange,  smoothstep(0.45, 0.75, t));
        col = mix(col, yellow,  smoothstep(0.60, 0.97, t));

        // greenish rim accent near outer band (more on top side)
        float rim = smoothstep(0.30, 0.60, t) * (1.0 - smoothstep(0.68, 0.92, t));
        float topBias = smoothstep(-0.1, 0.6, v_pos.y);
        col += green * rim * topBias * 0.65;
        return col;
      }

      void main(){
        // normalized, aspect-corrected coordinates
        float aspect = u_res.x / u_res.y;
        vec2 uv = v_pos;  // [-1,1]
        uv.x *= aspect;

        float t = u_time * (0.6 + 0.8*u_speed);
        float seed = u_seed;

        // Warp the space slightly for organic feel
        vec2 w = uv;
        w += 0.08*vec2(sin(uv.y*3.1 + t*0.7 + seed), cos(uv.x*2.8 - t*0.5 + seed));
        w *= rot(0.1*sin(t*0.23));

        // Sum of animated gaussian blobs
        float v = 0.0;
        float count = clamp(u_blobCount, 3.0, 7.0);
        for (int i=0;i<7;i++){
          if(float(i) >= count) break;
          float fi = float(i);
          float k = 0.7 + 0.15*fi;
          vec2 c = 0.35*vec2(
            sin(t*(0.7 + 0.13*fi) + seed + fi*1.7),
            cos(t*(0.9 - 0.11*fi) + seed*1.3 + fi*0.9)
          );
          c.x *= aspect; // keep circular motion under aspect
          float s = 0.22 + 0.06*sin(t*0.9 + fi*2.1 + seed);
          v += gauss(w - c, s) * (0.9 - 0.1*fi);
        }

        // Pointer attraction (subtle)
        vec2 m = vec2(u_mouse.x*aspect, u_mouse.y);
        v += gauss(w - m*0.7, 0.22) * 0.35;

        // starburst/glare — directional spikes with steep exponent
        float ang = atan(w.y, w.x);
        float rad = length(w);
        float spokes = pow(max(0.0, cos(6.0*ang + sin(t*0.7 + seed))), 24.0);
        float flare  = spokes * exp(-rad*5.0) * u_spikes * 1.2;
        v += flare;

        // normalize to [0,1] for palette mapping
        v = clamp(v, 0.0, 1.0);

        // slight time-driven contrast breathing
        v = pow(v, mix(1.05, 0.78, 0.5 + 0.5*sin(t*0.37)));

        vec3 col = palette(v);
        // gentle vignette
        float vig = smoothstep(1.3, 0.5, length(uv));
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

    const fit = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      const W = Math.floor(w * dpr), H = Math.floor(h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W; canvas.height = H;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const onPointer = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = ( (e.clientX - rect.left) / rect.width ) * 2 - 1;
      const y = ( (rect.height - (e.clientY - rect.top)) / rect.height ) * 2 - 1;
      mouseRef.current = [x, y];
    };

    const onClick = () => { seedRef.current = Math.random() * 1000; };

    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("click", onClick);
    window.addEventListener("resize", fit);
    fit();

    const render = (now) => {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;
      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, mouseRef.current[0], mouseRef.current[1]);
      gl.uniform1f(uSpeed, speed);
      gl.uniform1f(uSpikes, spikes);
      gl.uniform1f(uSeed, seedRef.current);
      gl.uniform1f(uBlobCt, blobs);

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
  }, [speed, spikes, blobs]);

  return (
    <div className={className} style={containerStyle}>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          borderRadius: "inherit",
        }}
      />
      <div
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          padding: "8px",
          color: "rgba(255,255,255,0.4)",
          fontSize: "12px",
          fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        move mouse · click to remix
      </div>
    </div>
  );
}

window.GooAura = GooAura;
