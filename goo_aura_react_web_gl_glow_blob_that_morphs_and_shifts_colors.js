((global) => {
  const defaultContainerStyle = {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: "520px",
    backgroundColor: "#000",
    borderRadius: "16px",
    overflow: "hidden",
  };

  const defaultCanvasStyle = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    borderRadius: "inherit",
  };

  const defaultOverlayStyle = {
    pointerEvents: "none",
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    padding: "8px",
    color: "rgba(255,255,255,0.35)",
    fontSize: "10px",
    fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  };

  const assignStyle = (el, style) => {
    if (!el || !style) return;
    for (const key in style) {
      if (Object.hasOwn(style, key)) {
        el.style[key] = style[key];
      }
    }
  };

  const mergeStyles = (base, extra) => {
    if (!extra) return { ...base };
    return { ...base, ...extra };
  };

  const createFallback2D = (canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => {};
    let raf = 0;

    const fit = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      const W = Math.floor(w * dpr);
      const H = Math.floor(h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
    };

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const t = performance.now() * 0.001;

      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5;
      const cy = h * 0.5;
      const r = Math.min(w, h) * 0.24;
      const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.6);
      g.addColorStop(0, "#ffd400");
      g.addColorStop(0.55, "#ff7a00");
      g.addColorStop(0.75, "#d400a6");
      g.addColorStop(1, "rgba(0,0,0,0)");

      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 0.26 + i * 1.05);
        ctx.translate(Math.cos(t * 0.4 + i) * r * 0.32, Math.sin(t * 0.6 + i) * r * 0.32);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.82 + 0.15 * Math.sin(t * 0.7 + i)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(render);
    };

    const onResize = () => {
      fit();
    };

    fit();
    render();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  };

  const compileShader = (gl, type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_pos;
    void main(){
      v_pos = a_position;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragShaderSource = `
    precision highp float;
    varying vec2 v_pos;
    uniform vec2  u_res;
    uniform float u_time;
    uniform vec2  u_mouse;
    uniform float u_speed;
    uniform float u_spikes;
    uniform float u_seed;
    uniform float u_blobCount;
    uniform float u_hue;
    uniform float u_centerPull;

    mat2 rot(float a){
      float s = sin(a);
      float c = cos(a);
      return mat2(c, -s, s, c);
    }

    float gauss(vec2 p, float s){
      return exp(-dot(p, p) / (2.0 * s * s));
    }

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
      vec2 uv = v_pos;
      uv.x *= aspect;

      float t = u_time * (0.32 + 0.60 * u_speed);
      float seed = u_seed;

      vec2 w = uv;
      w += 0.045 * vec2(
        sin(uv.y * 1.9 + t * 0.40 + seed),
        cos(uv.x * 1.8 - t * 0.34 + seed)
      );
      w *= rot(0.055 * sin(t * 0.16));

      float v = gauss(w, 0.34) * 0.10;

      float count = clamp(u_blobCount, 3.0, 7.0);
      float ampBase = 0.28;
      float amp     = ampBase * mix(1.0, 0.45, u_centerPull);

      for (int i = 0; i < 7; i++){
        if (float(i) >= count) break;
        float fi = float(i);
        vec2 c = amp * vec2(
          sin(t * (0.35 + 0.06 * fi) + seed + fi * 1.7),
          cos(t * (0.39 - 0.05 * fi) + seed * 1.3 + fi * 0.9)
        );
        c.x *= aspect;
        float s = 0.27 + 0.035 * sin(t * 0.45 + fi * 1.7 + seed);

        float g = gauss(w - c, s) * (0.95 - 0.12 * fi);
        v += g;

        vec2  rp = w - c;
        float ang = atan(rp.y, rp.x);
        float rad = length(rp);
        float n   = mix(4.0, 10.0, 0.5 + 0.5 * sin(t * 0.22 + fi * 0.8 + seed));
        float ph  = sin(t * (0.12 + 0.03 * fi) + seed * 1.1 + fi);
        float spokes = pow(max(0.0, cos(n * ang + ph)), 14.0);
        float flare  = spokes * exp(-rad * 4.8) * u_spikes * (1.1 - 0.12 * fi);
        v += flare;
      }

      vec2 m = vec2(u_mouse.x * aspect, u_mouse.y);
      v += gauss(w - m * 0.55, 0.28) * 0.12;

      v = clamp(v, 0.0, 1.0);
      v = pow(v, 0.94 + 0.05 * sin(t * 0.18));

      vec3 col = palette(v);
      col = hueRotate(col, u_hue);

      float vig = smoothstep(1.22, 0.56, length(uv));
      col *= vig;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const runGooAura = (canvas, options = {}) => {
    if (!canvas) return () => {};

    const config = {
      speed: options.speed ?? 0.6,
      spikes: options.spikes ?? 0.25,
      blobs: options.blobs ?? 5,
      hueSpeed: options.hueSpeed ?? 0.05,
      centerPull: options.centerPull ?? 0.65,
    };

    const state = {
      raf: 0,
      start: 0,
      mouseTarget: [0, 0],
      mouseSmooth: [0, 0],
      seed: Math.random() * 1000,
    };

    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) {
      return createFallback2D(canvas);
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, vertShaderSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragShaderSource);
    if (!vs || !fs) {
      gl?.deleteShader(vs);
      gl?.deleteShader(fs);
      return () => {};
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(program);
      return createFallback2D(canvas);
    }

    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uMouse = gl.getUniformLocation(program, "u_mouse");
    const uSpeed = gl.getUniformLocation(program, "u_speed");
    const uSpikes = gl.getUniformLocation(program, "u_spikes");
    const uSeed = gl.getUniformLocation(program, "u_seed");
    const uBlobCt = gl.getUniformLocation(program, "u_blobCount");
    const uHue = gl.getUniformLocation(program, "u_hue");
    const uCenter = gl.getUniformLocation(program, "u_centerPull");

    const fit = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      const W = Math.floor(w * dpr);
      const H = Math.floor(h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const onPointer = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((rect.height - (event.clientY - rect.top)) / rect.height) * 2 - 1;
      state.mouseTarget = [x, y];
    };

    const onClick = () => {
      state.seed = Math.random() * 1000;
    };

    const render = (now) => {
      if (!state.start) state.start = now;
      const t = (now - state.start) / 1000;
      const [tx, ty] = state.mouseTarget;
      const [sx, sy] = state.mouseSmooth;
      const easedX = sx + (tx - sx) * 0.04;
      const easedY = sy + (ty - sy) * 0.04;
      state.mouseSmooth = [easedX, easedY];

      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, easedX, easedY);
      gl.uniform1f(uSpeed, config.speed);
      gl.uniform1f(uSpikes, config.spikes);
      gl.uniform1f(uSeed, state.seed);
      gl.uniform1f(uBlobCt, config.blobs);
      gl.uniform1f(uHue, t * config.hueSpeed);
      gl.uniform1f(uCenter, config.centerPull);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      state.raf = requestAnimationFrame(render);
    };

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(state.raf);
      } else {
        state.start = performance.now();
        state.raf = requestAnimationFrame(render);
      }
    };

    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("click", onClick);
    window.addEventListener("resize", fit);
    document.addEventListener("visibilitychange", onVis);

    fit();
    state.raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(state.raf);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", fit);
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("click", onClick);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  };

  const mountGooAura = (root, options = {}) => {
    if (!root) return () => {};

    const container = document.createElement("div");
    assignStyle(container, mergeStyles(defaultContainerStyle, options.style));
    if (options.className) container.className = options.className;
    root.appendChild(container);

    const canvas = document.createElement("canvas");
    assignStyle(canvas, defaultCanvasStyle);
    container.appendChild(canvas);

    const overlay = document.createElement("div");
    assignStyle(overlay, mergeStyles(defaultOverlayStyle, options.overlayStyle));
  overlay.textContent = options.overlayText ?? "";
    container.appendChild(overlay);

    const cleanup = runGooAura(canvas, options);

    return () => {
      cleanup();
      if (container.parentNode === root) {
        root.removeChild(container);
      }
    };
  };

  const ReactGlobal = global.React;
  const noop = () => {};
  if (ReactGlobal?.useEffect && ReactGlobal?.useMemo && ReactGlobal?.useRef) {
    const { useEffect, useMemo, useRef, useCallback } = ReactGlobal;

    function GooAura({
      className = "",
      style = {},
      speed = 0.6,
      spikes = 0.25,
      blobs = 5,
      hueSpeed = 0.05,
      centerPull = 0.65,
  overlayText = "",
      overlayStyle,
    }) {
      const canvasRef = useRef(null);
      const cleanupRef = useRef(noop);

      const containerStyle = useMemo(() => mergeStyles(defaultContainerStyle, style), [style]);
      const mergedOverlayStyle = useMemo(() => mergeStyles(defaultOverlayStyle, overlayStyle), [overlayStyle]);

      const resetCleanup = useCallback(() => {
        cleanupRef.current();
        cleanupRef.current = noop;
      }, []);

      useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return noop;
        resetCleanup();
        cleanupRef.current = runGooAura(canvas, {
          speed,
          spikes,
          blobs,
          hueSpeed,
          centerPull,
          overlayText,
          overlayStyle,
        });
        return resetCleanup;
      }, [resetCleanup, speed, spikes, blobs, hueSpeed, centerPull, overlayText, overlayStyle]);

      useEffect(() => resetCleanup, [resetCleanup]);

      return ReactGlobal.createElement(
        "div",
        { className, style: containerStyle },
        ReactGlobal.createElement("canvas", { ref: canvasRef, style: defaultCanvasStyle }),
        ReactGlobal.createElement("div", { style: mergedOverlayStyle, className: "goo-aura__overlay" }, overlayText)
      );
    }

    global.GooAura = GooAura;
  }

  global.mountGooAura = mountGooAura;
  if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
    global.dispatchEvent(new CustomEvent("gooAuraReady"));
  }
})(window);
