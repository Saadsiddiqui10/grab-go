import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CameraRef, LngLatBounds } from '@maplibre/maplibre-react-native';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Text } from '../components/ui/Text';
import {
  DEV_DEFAULT_CENTER,
  DEV_DEFAULT_ZOOM,
  MAP_STYLE,
  MAP_STYLE_DESCRIPTION,
  mapPalette,
} from './config';
import { loadMapLibre, mapUnavailableReason } from './native';

/**
 * The Grab & Go map.
 *
 * A thin, reusable wrapper over MapLibre for React Native, rendering
 * OpenStreetMap data served by OpenFreeMap. No access token is involved.
 *
 * It renders `children` inside the map, which is the extension point — markers,
 * shape sources and layers can be added later without this component changing.
 */

export interface GrabGoMapProps {
  /** `[longitude, latitude]`. Defaults to the development centre. */
  center?: [number, number];
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Set false to freeze the camera. Pan and zoom are on by default. */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  onMapReady?: () => void;
  /**
   * `[west, south, east, north]` to frame, e.g. every pin on screen. Animates
   * whenever the value changes; `center` and `zoom` only set the first frame.
   */
  fitBounds?: LngLatBounds | null;
  /** Where the OpenStreetMap credit sits; move it clear of overlays. */
  attributionPosition?:
    | { top: number; left: number }
    | { top: number; right: number }
    | { bottom: number; right: number }
    | { bottom: number; left: number };
  /** Space to keep clear when fitting, e.g. under floating panels. */
  fitPadding?: { top: number; right: number; bottom: number; left: number };
  /** After every pan or zoom settles (including programmatic moves). */
  onRegionDidChange?: (view: { zoom: number; center: [number, number]; bounds: LngLatBounds }) => void;
  /** A tap on the map itself, not on a marker or tappable layer. */
  onPress?: () => void;
  /** Map content — annotations, sources, layers. */
  children?: ReactNode;
}

/** Camera moves for screens that need to steer the map, e.g. into a cluster. */
export interface GrabGoMapHandle {
  easeTo(center: [number, number], zoom: number): void;
  fitBounds(bounds: LngLatBounds, padding?: number): void;
}

/** Guards against a bad coordinate reaching the native side. */
function isValidCenter(center: [number, number]): boolean {
  const [longitude, latitude] = center;
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
  );
}

export const GrabGoMap = forwardRef<GrabGoMapHandle, GrabGoMapProps>(function GrabGoMap({
  center = DEV_DEFAULT_CENTER,
  zoom = DEV_DEFAULT_ZOOM,
  minZoom = 3,
  maxZoom = 19,
  interactive = true,
  style,
  onMapReady,
  fitBounds,
  fitPadding,
  attributionPosition = { bottom: 8, right: 8 },
  onRegionDidChange,
  onPress,
  children,
}, ref): React.JSX.Element {
  const unavailable = mapUnavailableReason();
  const maplibre = loadMapLibre();
  const cameraRef = useRef<CameraRef>(null);

  useImperativeHandle(
    ref,
    () => ({
      easeTo: (target, targetZoom) =>
        cameraRef.current?.easeTo({ center: target, zoom: targetZoom, duration: 450 }),
      fitBounds: (target, padding = 72) =>
        cameraRef.current?.fitBounds(target, {
          padding: { top: padding, bottom: padding, left: padding, right: padding },
          duration: 450,
        }),
    }),
    [],
  );

  // Fitting bounds needs a loaded map with a real size. Asked earlier (data
  // often arrives before layout), MapLibre sees a 0-high view, rejects the
  // padding as larger than the map and leaves the camera where it was.
  const [loaded, setLoaded] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) =>
      previous && previous.width === width && previous.height === height
        ? previous
        : { width, height },
    );
  }, []);

  // Keyed on the numbers, not the array, so a re-render with equal bounds
  // does not restart the animation.
  const boundsKey = fitBounds ? fitBounds.join(',') : null;
  useEffect(() => {
    if (!fitBounds || !loaded || !size || size.width === 0 || size.height === 0) return;
    // Room for the pins and their labels, but never more than a fifth of the
    // map on any side, so a short map still has space to fit into.
    const wanted = fitPadding ?? { top: 72, right: 48, bottom: 72, left: 48 };
    // Never let the padding eat the whole map: cap each pair at 80% of it.
    const scaleV = Math.min(1, (size.height * 0.8) / Math.max(1, wanted.top + wanted.bottom));
    const scaleH = Math.min(1, (size.width * 0.8) / Math.max(1, wanted.left + wanted.right));
    cameraRef.current?.fitBounds(fitBounds, {
      padding: {
        top: wanted.top * scaleV,
        bottom: wanted.bottom * scaleV,
        left: wanted.left * scaleH,
        right: wanted.right * scaleH,
      },
      duration: 600,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, loaded, size]);

  const handleReady = useCallback(() => {
    setLoaded(true);
    onMapReady?.();
  }, [onMapReady]);

  const handleFailed = useCallback(() => {
    // The style itself is bundled, but its tiles and glyphs are fetched over
    // the network, so a failure here is usually connectivity. The map keeps its last frame; logging is enough — the app
    // does not put an error surface over a map the user can still pan.
    console.warn('[map] MapLibre failed to load', MAP_STYLE_DESCRIPTION);
  }, []);

  if (unavailable !== null || maplibre === null) {
    return <MapUnavailable style={style} />;
  }

  const { Camera, Map } = maplibre;
  const safeCenter = isValidCenter(center) ? center : DEV_DEFAULT_CENTER;

  return (
    <View style={[styles.fill, style]} onLayout={onLayout}>
      <Map
        style={styles.fill}
        mapStyle={MAP_STYLE}
        // Ornaments: the map is a product surface, not a library demo. The
        // attribution stays on — OpenStreetMap's licence requires crediting the
        // data, and the OpenFreeMap TileJSON the style points at supplies that
        // string itself.
        logo={false}
        scaleBar={false}
        compass={false}
        attribution
        attributionPosition={attributionPosition}
        // Pan and zoom on; rotate and pitch off, as before.
        dragPan={interactive}
        touchZoom={interactive}
        doubleTapZoom={interactive}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingMap={handleReady}
        onDidFailLoadingMap={handleFailed}
        onRegionDidChange={
          onRegionDidChange
            ? (event) =>
                onRegionDidChange({
                  zoom: event.nativeEvent.zoom,
                  center: event.nativeEvent.center as [number, number],
                  bounds: event.nativeEvent.bounds,
                })
            : undefined
        }
        onPress={onPress ? () => onPress() : undefined}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: safeCenter, zoom }}
          minZoom={minZoom}
          maxZoom={maxZoom}
        />
        {children}
      </Map>
    </View>
  );
});

/**
 * Shown instead of the map when the native module is missing, which in practice
 * means the app is running in Expo Go rather than a development build.
 */
function MapUnavailable({ style }: { style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.fill,
        styles.centred,
        { backgroundColor: mapPalette.land, gap: theme.spacing.md },
        style,
      ]}
      accessibilityRole="alert"
    >
      <Ionicons name="map-outline" size={30} color={mapPalette.textSecondary} />
      <Text variant="title3" align="center" style={{ color: mapPalette.textPrimary }}>
        Map needs a development build
      </Text>
      <Text
        variant="footnote"
        align="center"
        style={{ color: mapPalette.textSecondary, maxWidth: 300 }}
      >
        MapLibre is a native module, so it cannot run in Expo Go. Build and install a
        development client to see the map.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
