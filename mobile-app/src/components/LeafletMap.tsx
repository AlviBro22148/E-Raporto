import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { useAfterTransition } from '../useAfterTransition';
import { useTheme } from '../theme';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  color: string;
  /** Diameter in px. Callers scale this by confirmation count so louder problems read louder. */
  size?: number;
  /** Announced to screen readers and shown in the marker's title attribute. */
  label?: string;
}

interface Props {
  markers?: MapMarker[];
  center: { lat: number; lng: number };
  zoom?: number;
  height?: number | string;
  /** Renders a draggable pin the citizen positions themselves. */
  pin?: { lat: number; lng: number; color?: string };
  interactive?: boolean;
  /** Large, touch-sized +/− buttons. Pinch-zoom always works when interactive. */
  showZoomControls?: boolean;
  /** Where to put them, so they don't land under the caller's own overlays. */
  zoomPosition?: 'topright' | 'bottomright' | 'topleft' | 'bottomleft';
  /** Extra px of clearance, e.g. to sit above a bottom CTA. */
  zoomInset?: number;
  /** Fit the viewport to the markers instead of honouring `center`/`zoom`. */
  fitToMarkers?: boolean;
  onMarkerPress?: (id: string) => void;
  onMapPress?: (coords: { lat: number; lng: number }) => void;
  onPinMove?: (coords: { lat: number; lng: number }) => void;
  style?: object;
}

/**
 * Map rendered as Leaflet inside a WebView.
 *
 * Why not `react-native-maps`: on Android it is backed by Google Maps, which means a native module
 * plus an API key, and it rendered blank in Expo Go on a real handset. Leaflet over OpenStreetMap
 * needs no key, no native module and no config, behaves identically in Expo Go and in a store build,
 * and is the same library the staff dashboard uses — so a pin looks the same to the citizen and to
 * the clerk.
 *
 * **The HTML is built once and never rebuilt.** Marker and pin updates are pushed into the live page
 * with injectJavaScript instead. Regenerating the HTML would remount the WebView on every state
 * change, throwing away the user's pan and zoom — which is exactly the bug you hit when the map
 * reset itself while you were positioning a pin.
 */
export function LeafletMap({
  markers = [], center, zoom = 13, height = 300, pin, interactive = true,
  showZoomControls = false, zoomPosition = 'topright', zoomInset = 10, fitToMarkers = false,
  onMarkerPress, onMapPress, onPinMove, style,
}: Props) {
  const t = useTheme();
  const webRef = useRef<WebView>(null);
  const ready = useRef(false);

  /**
   * The WebView is created only once the screen's entering animation has finished.
   *
   * Creating one is the single most expensive thing this app does — it spins up a
   * browser engine, and that work lands on the UI thread. Doing it while the
   * navigator animates is what made opening a report, and the new-report form,
   * drop frames: the screens that lag are exactly the screens with a map, and the
   * one map screen that doesn't lag is the initial route, which never animates in.
   *
   * Deferring here rather than in each screen means all four maps are covered by
   * one change, and this component stays the only thing that has to know a WebView
   * is costly to create.
   */
  const mounted = useAfterTransition();

  // The last position the WebView told us about. Used to avoid echoing a drag straight back at it,
  // which would fight the user's finger.
  const pinFromWeb = useRef<{ lat: number; lng: number } | null>(null);

  /**
   * Built once, at the moment the WebView actually mounts — not at first render.
   *
   * That distinction matters because the mount is deferred: on the new-report
   * screen a GPS fix can land while the placeholder is still up, and HTML captured
   * at first render would carry the stale default centre. The ready handler pushes
   * the pin but deliberately doesn't pan (panning would yank the view out from
   * under someone positioning it), so the map would open centred away from its own
   * pin. Building here means it opens correct.
   *
   * Still exactly once: later prop changes are pushed as commands, never rebuilt as
   * new HTML, which would remount the WebView and discard the user's pan and zoom.
   */
  const initialHtml = useRef<string | null>(null);
  if (mounted && initialHtml.current === null) {
    initialHtml.current = buildHtml({
      center, zoom, interactive, showZoomControls, zoomPosition, zoomInset, fitToMarkers,
      dark: t.scheme === 'dark',
      markers, pin,
    });
  }

  // Compared by value — `markers` is a fresh array on every parent render.
  const markersKey = useMemo(() => JSON.stringify(markers), [markers]);

  useEffect(() => {
    if (!ready.current) return;
    webRef.current?.injectJavaScript(`window.__setMarkers(${markersKey}); true;`);
  }, [markersKey]);

  useEffect(() => {
    if (!ready.current || !pin) return;
    // Only push a pin the map doesn't already have (e.g. a GPS fix arriving), never one it just
    // reported to us.
    const last = pinFromWeb.current;
    if (last && Math.abs(last.lat - pin.lat) < 1e-9 && Math.abs(last.lng - pin.lng) < 1e-9) return;
    webRef.current?.injectJavaScript(`window.__setPin(${pin.lat}, ${pin.lng}, true); true;`);
  }, [pin?.lat, pin?.lng]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      if (message.type === 'ready') {
        ready.current = true;
        // Push whatever arrived while the page was still loading.
        webRef.current?.injectJavaScript(`window.__setMarkers(${JSON.stringify(markers)}); true;`);
        if (pin) webRef.current?.injectJavaScript(`window.__setPin(${pin.lat}, ${pin.lng}, false); true;`);
        return;
      }

      if (message.type === 'marker' && message.id) onMarkerPress?.(message.id);
      else if (message.type === 'map') onMapPress?.({ lat: message.lat, lng: message.lng });
      else if (message.type === 'pin') {
        pinFromWeb.current = { lat: message.lat, lng: message.lng };
        onPinMove?.({ lat: message.lat, lng: message.lng });
      }
    } catch { /* ignore anything we didn't send ourselves */ }
  };

  return (
    // zIndex 0 keeps the map at the bottom of the stacking order; overlays set their own above it.
    <View style={[{ height: height as number, overflow: 'hidden', backgroundColor: t.surface3, zIndex: 0 }, style]}>
      {!mounted ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.brand2} />
        </View>
      ) : (
      <WebView
        ref={webRef}
        source={{ html: initialHtml.current ?? '' }}
        originWhitelist={['*']}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        onMessage={handleMessage}
        scrollEnabled={false}
        // The map handles its own gestures; letting the WebView bounce fights the pan.
        bounces={false}
        overScrollMode="never"
        javaScriptEnabled
        domStorageEnabled
        // Android needs this for the tile requests to be allowed to fire.
        mixedContentMode="always"
        // On Android, a hardware-layered WebView is backed by its own SurfaceView, composited by the
        // GPU independently of the rest of the view tree. Popping the screen this map sits on does not
        // reliably tear that surface down in step with the screen transition, and the leftover surface
        // is what renders as a flat, wrong-coloured rectangle over the whole screen afterwards — a
        // long-documented react-native-webview/Android issue, not anything specific to this map.
        // "software" renders through the normal Skia/View path instead of a SurfaceView, so there is no
        // independent surface left behind to go stale.
        //
        // "hardware" was tried explicitly at one point and reverted for an unrelated reason: it
        // composites above sibling views regardless of tree order, which hid the "report a problem"
        // button behind the map (overlays carry `elevation`, which is what actually drives native
        // z-order on Android — zIndex alone is not enough). "software" does not have that compositing
        // quirk either, so it does not reintroduce that bug while fixing this one.
        androidLayerType="software"
        setSupportMultipleWindows={false}
        accessibilityLabel="Harta e raporteve"
      />
      )}
    </View>
  );
}

function buildHtml({
  markers, center, zoom, pin, interactive, showZoomControls, zoomPosition, zoomInset,
  fitToMarkers, dark,
}: {
  markers: MapMarker[];
  center: { lat: number; lng: number };
  zoom: number;
  pin?: { lat: number; lng: number; color?: string };
  interactive: boolean;
  showZoomControls: boolean;
  zoomPosition: string;
  zoomInset: number;
  fitToMarkers: boolean;
  dark: boolean;
}) {
  // JSON.stringify keeps user-supplied strings (labels) from breaking out of the script context.
  const data = JSON.stringify({
    markers, center, zoom, pin, interactive, showZoomControls, zoomPosition, fitToMarkers, dark,
  });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${dark ? '#232935' : '#eef1f5'}; }
  .leaflet-control-attribution { font-size: 9px; }
  /* Muted basemap so the data marks stay the brightest thing on the map. */
  .leaflet-tile { filter: ${dark ? 'invert(1) hue-rotate(180deg) brightness(.82) contrast(.92)' : 'saturate(.6) brightness(1.03)'}; }
  .pin { border-radius: 50%; border: 2.5px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.4); }
  .pin-drag { border-width: 3px; }

  /* Leaflet's default zoom buttons are 26px — well under the 44px touch floor. */
  .leaflet-control-zoom { border: none !important; box-shadow: 0 2px 8px rgba(0,0,0,.25) !important; }
  .leaflet-control-zoom a {
    width: 44px !important; height: 44px !important;
    line-height: 42px !important; font-size: 24px !important;
    font-weight: 600;
    color: ${dark ? '#E8ECF1' : '#14181F'} !important;
    background: ${dark ? '#171B22' : '#fff'} !important;
    border-bottom: 1px solid ${dark ? '#2A3240' : '#DDE2E8'} !important;
  }
  .leaflet-control-zoom a:last-child { border-bottom: none !important; }
  .leaflet-bottom .leaflet-control-zoom { margin-bottom: ${zoomInset}px !important; }
  .leaflet-top .leaflet-control-zoom { margin-top: ${zoomInset}px !important; }
  .leaflet-control-zoom a:active { background: ${dark ? '#232935' : '#EEF1F5'} !important; }
</style>
</head>
<body>
<div id="map"></div>
<script>
(function () {
  var cfg = ${data};
  var send = function (payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  };

  var map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    dragging: cfg.interactive,
    touchZoom: cfg.interactive,
    doubleClickZoom: cfg.interactive,
    scrollWheelZoom: cfg.interactive,
    tap: cfg.interactive
  }).setView([cfg.center.lat, cfg.center.lng], cfg.zoom);

  if (cfg.showZoomControls) {
    L.control.zoom({ position: cfg.zoomPosition }).addTo(map);
  }

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  var icon = function (color, size, extraClass) {
    return L.divIcon({
      className: '',
      html: '<div class="pin ' + (extraClass || '') + '" style="width:' + size + 'px;height:' + size + 'px;background:' + color + ';"></div>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  };

  /* ── Markers, replaceable without reloading the page ──────────────────── */

  var markerLayer = L.layerGroup().addTo(map);

  window.__setMarkers = function (list) {
    markerLayer.clearLayers();
    var bounds = [];
    (list || []).forEach(function (m) {
      var size = m.size || 18;
      var marker = L.marker([m.lat, m.lng], {
        icon: icon(m.color, size),
        title: m.label || '',
        alt: m.label || ''
      });
      marker.on('click', function () { send({ type: 'marker', id: m.id }); });
      marker.addTo(markerLayer);
      bounds.push([m.lat, m.lng]);
    });
    // Only auto-fit on the first batch — refitting later would yank the map out from under a user
    // who has panned somewhere deliberately.
    if (cfg.fitToMarkers && !window.__didFit && bounds.length > 0) {
      window.__didFit = true;
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
  };

  /* ── Draggable pin ────────────────────────────────────────────────────── */

  var dragPin = null;

  window.__setPin = function (lat, lng, recenter) {
    if (!dragPin) {
      dragPin = L.marker([lat, lng], {
        icon: icon(${JSON.stringify(pin?.color ?? '#1D4E89')}, 30, 'pin-drag'),
        draggable: cfg.interactive,
        autoPan: true,
        keyboard: false
      }).addTo(map);

      dragPin.on('dragend', function (e) {
        var p = e.target.getLatLng();
        send({ type: 'pin', lat: p.lat, lng: p.lng });
      });
    } else {
      dragPin.setLatLng([lat, lng]);
    }
    // Keep the current zoom — the citizen may have zoomed in to place the pin precisely.
    if (recenter) map.panTo([lat, lng]);
  };

  if (cfg.pin) {
    window.__setPin(cfg.pin.lat, cfg.pin.lng, false);
  }

  // Tapping the map is faster than a precise drag on a phone.
  map.on('click', function (e) {
    if (dragPin) {
      dragPin.setLatLng(e.latlng);
      send({ type: 'pin', lat: e.latlng.lat, lng: e.latlng.lng });
    } else if (cfg.interactive) {
      send({ type: 'map', lat: e.latlng.lat, lng: e.latlng.lng });
    }
  });

  window.__setMarkers(cfg.markers);

  // The WebView is often laid out after first paint; without this the tiles render into a 0x0 box.
  setTimeout(function () { map.invalidateSize(); }, 120);
  window.addEventListener('resize', function () { map.invalidateSize(); });

  send({ type: 'ready' });
}());
</script>
</body>
</html>`;
}
