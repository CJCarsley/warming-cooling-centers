import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import MapView from '@arcgis/core/views/MapView';
import Map from '@arcgis/core/Map';
import { MAP_CONFIG } from '../config/map';

export function useMapView(
  containerRef: RefObject<HTMLDivElement>,
): MapView | null {
  const [view, setView] = useState<MapView | null>(null);
  const viewRef = useRef<MapView | null>(null);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const map = new Map({ basemap: MAP_CONFIG.basemap });
    const mapView = new MapView({
      container: containerRef.current,
      map,
      center: [MAP_CONFIG.centerLng, MAP_CONFIG.centerLat],
      zoom: MAP_CONFIG.zoom,
    });

    // Disable default popup — we render a custom React dialog instead
    mapView.popupEnabled = false;

    viewRef.current = mapView;

    mapView
      .when(() => {
        setView(mapView);
      })
      .catch((err: unknown) => {
        console.error('MapView failed to initialize:', err);
      });

    return () => {
      mapView.destroy();
      viewRef.current = null;
      setView(null);
    };
    // containerRef.current is accessed inside the effect intentionally;
    // the RefObject itself is stable and does not need to be in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return view;
}
