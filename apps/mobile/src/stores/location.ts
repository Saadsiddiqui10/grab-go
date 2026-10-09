import { create } from 'zustand';
import * as Location from 'expo-location';
import { LAUNCH_CITY } from '@grabgo/config';
import { StorageKey, appStorage } from '../lib/storage';

/**
 * Location.
 *
 * The rule this store exists to enforce: **location is optional**. Declining the
 * OS prompt is a supported path, not a dead end — the customer picks an area
 * instead and everything else works identically, only sorted by relevance rather
 * than distance.
 *
 * The permission prompt is never shown on launch. It appears when the customer
 * taps "Near me", where the reason for asking is obvious.
 */

export type LocationPermission = 'unknown' | 'granted' | 'denied' | 'undetermined';

export interface ManualArea {
  areaId: string;
  areaName: string;
  cityId: string;
  cityName: string;
  latitude: number;
  longitude: number;
}

interface LocationState {
  permission: LocationPermission;
  coords: { latitude: number; longitude: number } | null;
  manualArea: ManualArea | null;
  isLocating: boolean;

  hydrate: () => Promise<void>;
  checkPermission: () => Promise<LocationPermission>;
  requestAndLocate: () => Promise<boolean>;
  setManualArea: (area: ManualArea | null) => Promise<void>;
  /** Coordinates to search around: GPS if allowed, else the chosen area. */
  origin: () => { latitude: number; longitude: number } | null;
  /** What to show in the header: "Clifton", "Near you", or the launch city. */
  label: () => string;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  permission: 'unknown',
  coords: null,
  manualArea: null,
  isLocating: false,

  async hydrate() {
    const stored = await appStorage.getJson<{ manualArea: ManualArea | null }>(
      StorageKey.location,
    );
    if (stored?.manualArea) set({ manualArea: stored.manualArea });

    // Read the current status without prompting, so a customer who already
    // granted access gets nearby results immediately.
    const { status } = await Location.getForegroundPermissionsAsync();
    set({ permission: toPermission(status) });

    if (status === Location.PermissionStatus.GRANTED) {
      void get().requestAndLocate();
    }
  },

  async checkPermission() {
    const { status } = await Location.getForegroundPermissionsAsync();
    const permission = toPermission(status);
    set({ permission });
    return permission;
  },

  async requestAndLocate() {
    set({ isLocating: true });

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const permission = toPermission(status);
      set({ permission });

      if (permission !== 'granted') return false;

      // Balanced accuracy: a cafe list needs the right neighbourhood, not the
      // right doorstep, and high accuracy costs battery and seconds.
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      set({
        coords: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
      });

      return true;
    } catch {
      // Location can fail with permission granted (airplane mode, no fix).
      // Browsing continues without it.
      return false;
    } finally {
      set({ isLocating: false });
    }
  },

  async setManualArea(area) {
    set({ manualArea: area });
    await appStorage.setJson(StorageKey.location, { manualArea: area });
  },

  origin() {
    const state = get();
    if (state.permission === 'granted' && state.coords) return state.coords;
    // Return the stored area itself, not a new { latitude, longitude }: this
    // is read through store selectors, and a fresh object on every read looks
    // like a change every time, which re-renders forever ("Maximum update
    // depth exceeded" after picking an area).
    if (state.manualArea) return state.manualArea;
    return null;
  },

  label() {
    const state = get();
    if (state.manualArea) return state.manualArea.areaName;
    if (state.permission === 'granted' && state.coords) return 'Near you';
    return LAUNCH_CITY.name;
  },
}));

function toPermission(status: Location.PermissionStatus): LocationPermission {
  switch (status) {
    case Location.PermissionStatus.GRANTED:
      return 'granted';
    case Location.PermissionStatus.DENIED:
      return 'denied';
    default:
      return 'undetermined';
  }
}
