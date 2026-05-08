import { useMemo } from 'react';
import type { FacilityWithLocation } from './useFeatureLayer';

export interface NearbyResult {
  facility: FacilityWithLocation;
  distanceMi: number;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useNearby(
  point: { latitude: number; longitude: number } | null,
  facilities: FacilityWithLocation[],
  limit = 5,
): NearbyResult[] {
  return useMemo(() => {
    if (!point || !facilities.length) return [];
    return facilities
      .filter(
        (f) =>
          f.attributes.Warming_Active === 'Yes' || f.attributes.Cooling_Active === 'Yes',
      )
      .map((f) => ({
        facility: f,
        distanceMi:
          haversineKm(point.latitude, point.longitude, f.latitude, f.longitude) * 0.621371,
      }))
      .sort((a, b) => a.distanceMi - b.distanceMi)
      .slice(0, limit);
  }, [point, facilities, limit]);
}
