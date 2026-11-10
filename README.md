# Strava Street View

A Chrome extension that adds **Open in Street View** to the right-click menu on
[strava.com/maps](https://www.strava.com/maps).

- **Browsing mode:** Strava shows its own menu ("Start route here"). The
  extension adds a second item to it.
- **Route-planning mode:** Strava shows no menu. The extension shows its own
  one-item menu, reusing Strava's menu styling when it has seen it.

Picking the item opens Google Street View for that point in a new tab:
`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LNG&heading=1`.
The non-zero `heading` matters: without it Google Maps opens a black view
until you move.
If Google has no imagery there, Maps snaps to the nearest panorama.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Open strava.com/maps and right-click the map.

After editing files, click the reload icon on the extension card, then reload
the Strava tab.

## How it works

Strava's map is a custom WebAssembly engine drawn into
`<canvas data-testid="mre-canvas">`, not Mapbox GL JS. The content script runs
in the page's MAIN world so it can reach the engine through React internals:

- **Coordinates:** the engine's JS bridge object (found by searching React hook
  state above `[data-testid="mre-map-container"]` for an object with
  `getCamera()`) exposes `camera.getCustomLookAtPoint(x, y)`, which takes
  normalized canvas coordinates (0..1) and returns the lat/lng under that
  point. It accounts for 3D tilt and rotation.
- **Browsing mode:** Strava's menu (`[data-testid="mre-popup"]` with a
  `CreateMenu_createMenu` class) shows up about 1s after the right-click. Its
  React parent has a `latLng: [lat, lng]` prop, which is used first. A
  MutationObserver adds our button next to "Start here", cloned from it so the
  styling matches.
- **Route-planning mode:** detected by the URL (`/maps/create`), where we show
  our own menu, reusing Strava's button classes once we've seen them.
- **Closing Strava's menu:** a synthetic Escape only works when dispatched on
  the canvas.

Set `DEBUG = true` in `src/content.js` to log what was resolved.

## Fragility

This depends on Strava internals: `data-testid` values, CSS-module class
prefixes, the `latLng` prop, and the engine's `getCamera` /
`getCustomLookAtPoint` methods. If Strava ships a change and the item stops
appearing or opens the wrong place, those are the things to re-check.
