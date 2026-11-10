// Strava Street View — runs in the page's MAIN world so it can reach Strava's
// map engine through React internals.
//
// How Strava's map works (verified Nov 2026):
// - The map is a WebAssembly engine drawn into <canvas data-testid="mre-canvas">
//   inside <div data-testid="mre-map-container">. It is not Mapbox GL JS.
// - A JS bridge object for the engine lives in a React hook on the map
//   container's parent component. It has getCamera(), and the camera has
//   getCustomLookAtPoint(nx, ny): normalized canvas coords (0..1) ->
//   { isPointingAtMap, worldPoint: { latitude, longitude, elevation } }.
//   This accounts for 3D tilt and rotation.
// - Browsing mode: right-click shows <div data-testid="mre-popup"
//   class="... CreateMenu_createMenu ..."> with a "Start here" button. Its
//   React parent has a latLng: [lat, lng] prop. Escape removes it.
// - Route-planning mode (/maps/create): right-click shows nothing.

(() => {
  "use strict";

  const DEBUG = false;
  const LABEL = "Open in Street View";
  const CLASS_CACHE_KEY = "strava-streetview:menu-classes";

  const log = (...a) => DEBUG && console.log("[strava-streetview]", ...a);

  let lastClick = null; // { x, y } in client coords
  let fallbackMenu = null;

  // ---------- Street View ----------

  function openStreetView({ lat, lng }) {
    const url =
      "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" +
      `${lat.toFixed(6)},${lng.toFixed(6)}`;
    window.open(url, "_blank", "noopener");
  }

  // ---------- Finding coordinates ----------

  function fiberOf(el) {
    const key = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    return key ? el[key] : null;
  }

  // The engine object's hook position differs between pages, so search the
  // hook states (and effect deps) of the container's ancestors for it.
  function findEngine() {
    const container = document.querySelector('[data-testid="mre-map-container"]');
    const isEngine = (o) => o && typeof o === "object" && typeof o.getCamera === "function";
    for (let f = fiberOf(container), i = 0; f && i < 8; f = f.return, i++) {
      let h = f.memoizedState;
      for (let j = 0; h && typeof h === "object" && "next" in h && j < 150; j++, h = h.next) {
        const s = h.memoizedState;
        if (!s || typeof s !== "object") continue;
        const candidates = [s, s.current, ...(Array.isArray(s) ? s : [])];
        // Effect hooks: a circular list of effects, each with deps.
        for (let e = s, k = 0; e && typeof e === "object" && k < 10; e = e.next, k++) {
          if (Array.isArray(e.deps)) candidates.push(...e.deps);
          if (e.next === s) break;
        }
        const hit = candidates.find(isEngine);
        if (hit) return hit;
      }
    }
    return null;
  }

  function latLngFromEngine(clientX, clientY) {
    const canvas = document.querySelector('canvas[data-testid="mre-canvas"]');
    const engine = findEngine();
    if (!canvas || !engine) return null;
    const r = canvas.getBoundingClientRect();
    const nx = (clientX - r.left) / r.width;
    const ny = (clientY - r.top) / r.height;
    try {
      const res = engine.getCamera().getCustomLookAtPoint(nx, ny);
      if (!res || !res.isPointingAtMap) return null; // e.g. clicked the sky in 3D
      return { lat: res.worldPoint.latitude, lng: res.worldPoint.longitude };
    } catch (err) {
      log("engine lookup failed", err);
      return null;
    }
  }

  function latLngFromNativeMenu(popup) {
    for (let f = fiberOf(popup), i = 0; f && i < 5; f = f.return, i++) {
      const ll = f.memoizedProps && f.memoizedProps.latLng;
      if (Array.isArray(ll) && typeof ll[0] === "number") return { lat: ll[0], lng: ll[1] };
    }
    return null;
  }

  function resolveLatLng(nativePopup) {
    const fromEngine = lastClick && latLngFromEngine(lastClick.x, lastClick.y);
    const fromMenu = nativePopup && latLngFromNativeMenu(nativePopup);
    log("resolved", { fromEngine, fromMenu });
    return fromMenu || fromEngine;
  }

  function go(nativePopup) {
    const ll = resolveLatLng(nativePopup);
    if (ll) openStreetView(ll);
    else console.warn("[strava-streetview] could not determine coordinates");
  }

  // ---------- Menus ----------

  const STREET_VIEW_ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" ' +
    'style="flex:none;margin-right:8px;vertical-align:-3px">' +
    '<circle cx="12" cy="5" r="3" fill="currentColor"/>' +
    '<path d="M8 10h8l-1 7h-2l-1 5-1-5H9z" fill="currentColor"/></svg>';

  function isCreateMenu(node) {
    return node instanceof HTMLElement &&
      node.matches('[data-testid="mre-popup"]') &&
      /CreateMenu_createMenu/.test(node.className);
  }

  function augmentNativeMenu(popup) {
    if (popup.querySelector(".ssv-item")) return;
    const startBtn = popup.querySelector("button");
    if (!startBtn) return;

    try {
      localStorage.setItem(CLASS_CACHE_KEY, JSON.stringify({ item: startBtn.className }));
    } catch {}

    // cloneNode doesn't copy React's handlers, so the clone is inert until we wire it.
    const ours = startBtn.cloneNode(false);
    ours.classList.add("ssv-item");
    ours.innerHTML = STREET_VIEW_ICON;
    ours.append(LABEL);
    ours.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      go(popup);
      closeNativeMenu();
    }, true);
    startBtn.after(ours);
  }

  // Strava closes its menu on Escape, but only when the key event reaches
  // the canvas (dispatching on document or window does nothing).
  function closeNativeMenu() {
    const canvas = document.querySelector('canvas[data-testid="mre-canvas"]');
    const opts = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true };
    canvas?.dispatchEvent(new KeyboardEvent("keydown", opts));
    canvas?.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function showFallbackMenu(x, y) {
    closeFallbackMenu();
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CLASS_CACHE_KEY)); } catch {}

    const menu = document.createElement("div");
    menu.className = "ssv-menu";
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ssv-item" + (cached ? " ssv-native " + cached.item : "");
    item.innerHTML = STREET_VIEW_ICON;
    item.append(LABEL);
    item.addEventListener("click", () => {
      closeFallbackMenu();
      go(null);
    });
    menu.appendChild(item);
    document.body.appendChild(menu);

    // Keep it on screen.
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
    fallbackMenu = menu;
  }

  function closeFallbackMenu() {
    fallbackMenu?.remove();
    fallbackMenu = null;
  }

  // ---------- Wiring ----------

  const isRoutePlanning = () => location.pathname.startsWith("/maps/create");

  const isMapCanvas = (t) =>
    t instanceof HTMLCanvasElement && t.matches('[data-testid="mre-canvas"]');

  window.addEventListener("contextmenu", (e) => {
    if (!isMapCanvas(e.target)) return;
    e.preventDefault(); // never show the browser's own menu over the map
    lastClick = { x: e.clientX, y: e.clientY };
    closeFallbackMenu();
    // Strava's own menu takes ~1s to appear in browsing mode, so decide by
    // URL rather than waiting: route planning lives under /maps/create.
    if (isRoutePlanning()) showFallbackMenu(e.clientX, e.clientY);
  }, true);

  window.addEventListener("pointerdown", (e) => {
    if (fallbackMenu && !fallbackMenu.contains(e.target)) closeFallbackMenu();
  }, true);
  window.addEventListener("keydown", (e) => e.key === "Escape" && closeFallbackMenu(), true);
  window.addEventListener("wheel", closeFallbackMenu, { capture: true, passive: true });

  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        const popup = isCreateMenu(n) ? n : n.querySelector?.('[data-testid="mre-popup"]');
        if (popup && isCreateMenu(popup)) augmentNativeMenu(popup);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  log("loaded");
})();
