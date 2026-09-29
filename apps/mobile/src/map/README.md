# Map

MapLibre GL for React Native, rendering OpenStreetMap data served by OpenFreeMap.

```
src/map/
  grabgo-style.ts  the branded MapLibre style
  config.ts        style selection + camera defaults
  native.ts        guarded access to the native module
  GrabGoMap.tsx    the reusable map component
app/map.tsx        a screen that renders it
```

| | |
| --- | --- |
| Renderer | MapLibre GL (`@maplibre/maplibre-react-native`) |
| Tiles | OpenFreeMap — `https://tiles.openfreemap.org/planet` |
| Glyphs | OpenFreeMap — Noto Sans |
| Data | OpenStreetMap, via the OpenMapTiles schema |
| Style | `grabgo-style.ts`, authored in this repo |
| Access token | **None.** No key, no account, no billing |

---

## Why this package and not `maplibre-gl`

`maplibre-gl` is the **browser** library. It renders into a DOM canvas and needs
`window` and `document`, so it cannot run in React Native. The React Native
binding is `@maplibre/maplibre-react-native`, which wraps the native MapLibre
SDKs on iOS and Android. Same renderer, same style format, same OpenFreeMap
style URL — just the correct package for this platform.

The two web dashboards (`apps/merchant-dashboard`, `apps/admin-dashboard`) have
no map, so `maplibre-gl` is not needed anywhere in this repo. If a map is ever
added there, that is the package to use, and it can point at the same
OpenFreeMap style URL.

---

## Cannot run in Expo Go

MapLibre is native code, and Expo Go ships a fixed set of native modules that
does not include it. A **development build** is required.

`native.ts` loads the module behind a try/catch, so this failure stays local:
the map screen explains itself and the rest of the app keeps working in Expo Go.

### Android development build

No tokens or secrets are involved — that is the main practical improvement over
the Mapbox setup this replaced.

```powershell
# EAS (no local Android SDK needed)
npm install -g eas-cli
cd "C:\Saad\work\Grab & Go\apps\mobile"
eas login
eas build:configure
eas build --profile development --platform android
```

```powershell
# Local — requires Android Studio, the Android SDK and ANDROID_HOME
cd "C:\Saad\work\Grab & Go\apps\mobile"
npx expo run:android
```

Install the build, then `npx expo start --dev-client`.

---

## Attribution

OpenStreetMap's licence requires crediting the data, and OpenFreeMap asks that
the attribution its style provides is shown.

The style points at OpenFreeMap's TileJSON, which carries the attribution
string — OpenFreeMap, OpenMapTiles and OpenStreetMap — and the map is rendered
with `attribution` enabled so MapLibre displays it. It is positioned
bottom-right, out of the way of the app's own UI, but **not hidden**. Do not
turn `attribution` off.

---

## The style

The map does not render a stock basemap. `grabgo-style.ts` is a hand-written
MapLibre style document: cream land, a warm road hierarchy that carries
importance through weight rather than hue, buildings barely lifted off the
ground, and **no POI icons at all** — every icon a basemap draws is one the
product's own cafe markers would have to compete with.

It is a style *document*, not a hosted style URL. MapLibre accepts either, and
passing the object means there is nothing to host and nothing to keep in sync.

### Schema notes

The style reads the OpenMapTiles schema, which names things differently from
Mapbox Streets. The mapping is documented in full at the top of
`grabgo-style.ts`; the parts worth knowing here:

| Feature | Where it lives |
| --- | --- |
| Parks | the `park` source-layer, not a `landuse` class |
| Airports | the `aeroway` source-layer, not a `landuse` class |
| Residential streets | `transportation` class `minor`, not `street` |
| Motorway ramps | `class: motorway` with `ramp: 1` — not a class of their own |
| Railways | `rail` / `transit`, not `major_rail` / `minor_rail` |
| Road names | the `transportation_name` source-layer, separate from the geometry |
| Boundaries | `boundary`, not `admin` |
| Place labels | `place`, split by `class` into region / settlement / suburb |

Every class the style filters on was checked against a live Karachi tile rather
than taken from documentation.

## Changing the style

Set an override to bypass the branded style and render any other
MapLibre-compatible style, without touching application code:

```bash
# apps/mobile/.env
EXPO_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
```

It can also be set as `extra.mapStyleUrl` in `app.json` to bake a per-build
default into CI. Clear it to go back to the Grab & Go style.

---

## Using the component

```tsx
import { GrabGoMap } from '../src/map/GrabGoMap';

<GrabGoMap />                                  // dev default: Clifton, Karachi
<GrabGoMap center={[67.03, 24.81]} zoom={14} />
```

`GrabGoMap` renders its `children` inside the map, which is the extension point
for markers, sources and layers later — none of which exist yet.

The development centre in `config.ts` is Clifton, where the seeded demo cafes
are. It is a convenience for building, **not** the user's real location.

Invalid coordinates fall back to the development centre rather than being handed
to the native side, and a style that fails to load is logged rather than
replacing the map the user can still pan.
