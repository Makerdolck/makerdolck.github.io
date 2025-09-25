/**
 * Legacy shim: keep old filename around but defer to compiled JS bundle.
 * This file will inject the production bundle when loaded directly.
 */
(function loadGooAuraBundle() {
  if (window.GooAura || window.mountGooAura) return;
  const script = document.createElement("script");
  script.src = "./goo_aura_react_web_gl_glow_blob_that_morphs_and_shifts_colors.js";
  script.defer = true;
  document.head.appendChild(script);
})();
