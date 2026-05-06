import { useRef, useState, useEffect, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import Search from '@arcgis/core/widgets/Search';
import Locate from '@arcgis/core/widgets/Locate';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import type EsriMap from '@arcgis/core/Map';
import { useMapView } from '../../hooks/useMapView';
import { useFeatureLayer } from '../../hooks/useFeatureLayer';
import { useNearby } from '../../hooks/useNearby';
import FacilityPopup from './FacilityPopup';
import MapLegend from './MapLegend';
import NearbyPanel from './NearbyPanel';
import type { FacilityAttributes } from '../../types/facility';
import { getFacilityType } from '../../types/facility';
import styles from './MapView.module.css';

const FACILITY_TYPE_KEYS = {
  warming: 'facilityType.warming',
  cooling: 'facilityType.cooling',
  dual: 'facilityType.dual',
  inactive: 'facilityType.inactive',
} as const;

export default function MapViewComponent() {
  const { t } = useTranslation();
  const { t: tMap } = useTranslation('map');
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const view = useMapView(mapContainerRef);
  const { layer, facilities, facilitiesWithLocation } = useFeatureLayer(view);

  const pinLayerRef = useRef<GraphicsLayer | null>(null);
  const flashTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [selectedFacility, setSelectedFacility] =
    useState<FacilityAttributes | null>(null);
  const [selectedFacilityLocation, setSelectedFacilityLocation] =
    useState<{ latitude: number; longitude: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [nearbyPoint, setNearbyPoint] = useState<{ latitude: number; longitude: number } | null>(null);

  const nearbyResults = useNearby(nearbyPoint, facilitiesWithLocation);

  const liveRegionId = useId();

  const handlePopupClose = useCallback(() => {
    setSelectedFacility(null);
    setSelectedFacilityLocation(null);
    mapContainerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!view) return;
    const pinLayer = new GraphicsLayer();
    (view.map as EsriMap).add(pinLayer);
    pinLayerRef.current = pinLayer;
    return () => {
      flashTimersRef.current.forEach(clearTimeout);
      flashTimersRef.current = [];
      if (!view.destroyed) (view.map as EsriMap).remove(pinLayer);
      pinLayerRef.current = null;
    };
  }, [view]);

  useEffect(() => {
    if (!view || !layer) return;

    const currentView = view;
    const currentLayer = layer;

    const handle = currentView.on('click', (event) => {
      void currentView
        .hitTest(event, { include: [currentLayer] })
        .then((response) => {
          const result = response.results[0];
          if (result && result.type === 'graphic') {
            const attrs = result.graphic.attributes as FacilityAttributes;
            const geom = result.graphic.geometry as { latitude: number; longitude: number };
            setSelectedFacility(attrs);
            setSelectedFacilityLocation({ latitude: geom.latitude, longitude: geom.longitude });
            setAnnouncement(tMap('map.facilitySelected', { name: attrs.Name }));
          } else {
            setSelectedFacility(null);
            const { latitude, longitude } = event.mapPoint;
            const pinLayer = pinLayerRef.current;
            if (pinLayer) {
              flashTimersRef.current.forEach(clearTimeout);
              flashTimersRef.current = [];
              pinLayer.graphics.removeAll();
              pinLayer.graphics.add(
                new Graphic({
                  geometry: new Point({ latitude, longitude }),
                  symbol: new SimpleMarkerSymbol({
                    style: 'circle',
                    color: [255, 215, 0, 0.9],
                    size: '18px',
                    outline: { color: [80, 60, 0, 1], width: 2 },
                  }),
                }),
              );
              pinLayer.opacity = 1;
              flashTimersRef.current.push(
                setTimeout(() => { pinLayer.opacity = 0; }, 250),
              );
              flashTimersRef.current.push(
                setTimeout(() => { pinLayer.opacity = 1; }, 500),
              );
            }
            setNearbyPoint({ latitude, longitude });
          }
        })
        .catch((err: unknown) => {
          console.error('hitTest error:', err);
        });
    });

    return () => handle.remove();
  }, [view, layer, tMap]);

  useEffect(() => {
    if (!view) return;

    const search = new Search({ view });
    const locate = new Locate({ view });

    view.ui.add(search, 'top-right');
    view.ui.add(locate, 'top-right');

    // ArcGIS TS typings don't expose 'select-result' in on() overloads; cast to any.
    // Use .latitude/.longitude (not .x/.y) — ArcGIS auto-converts to WGS84 regardless of source SR.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchHandle = (search as any).on('select-result', (event: { result?: { feature?: { geometry?: { latitude?: number; longitude?: number } } } }) => {
      const geom = event.result?.feature?.geometry;
      if (geom && typeof geom.latitude === 'number' && typeof geom.longitude === 'number') {
        setNearbyPoint({ latitude: geom.latitude, longitude: geom.longitude });
      }
    });

    const locateHandle = locate.on('locate', (event: { position?: { coords?: { latitude: number; longitude: number } } }) => {
      const coords = event.position?.coords;
      if (coords) {
        setNearbyPoint({ latitude: coords.latitude, longitude: coords.longitude });
      }
    });

    return () => {
      searchHandle.remove();
      locateHandle.remove();
      search.destroy();
      locate.destroy();
    };
  }, [view]);

  return (
    <div className={styles.wrapper}>
      <div
        id={liveRegionId}
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      >
        {announcement}
      </div>

      <div className={styles.mapContainer}>
        {/* role="application" is an ARIA widget role; tabIndex={0} is required for keyboard entry */}
        <div
          ref={mapContainerRef}
          className={styles.mapView}
          role="application"
          aria-label={tMap('map.ariaLabel')}
          tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex
        />
        <MapLegend />
        {nearbyResults.length > 0 && (
          <NearbyPanel
            results={nearbyResults}
            originPoint={nearbyPoint}
            onClose={() => {
              if (pinLayerRef.current) pinLayerRef.current.graphics.removeAll();
              setNearbyPoint(null);
            }}
          />
        )}
      </div>

      {selectedFacility && selectedFacilityLocation && (
        <FacilityPopup
          facility={selectedFacility}
          facilityLocation={selectedFacilityLocation}
          originPoint={nearbyPoint}
          onClose={handlePopupClose}
        />
      )}

      {/* Accessible text alternative — screen-reader-only table */}
      <section
        className={styles.srOnly}
        aria-label={tMap('map.facilityListLabel')}
      >
        <h2>{tMap('map.facilityListHeading')}</h2>
        <table>
          <caption>{tMap('map.facilityTableCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('facility.name')}</th>
              <th scope="col">{t('facility.address')}</th>
              <th scope="col">{t('facility.type')}</th>
              <th scope="col">{t('status.open')}</th>
              <th scope="col">{t('facility.hours')}</th>
              <th scope="col">{t('facility.phone')}</th>
              <th scope="col">{t('facility.capacityStatus')}</th>
              <th scope="col">{t('facility.adaCompliant')}</th>
              <th scope="col">{t('facility.eligibility')}</th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => {
              const fType = getFacilityType(f);
              const isActive = fType !== 'inactive';
              return (
                <tr key={f.ObjectID}>
                  <td>{f.Name}</td>
                  <td>{f.Address ?? t('common.notAvailable')}</td>
                  <td>{tMap(FACILITY_TYPE_KEYS[fType])}</td>
                  <td>{isActive ? t('status.open') : t('status.closed')}</td>
                  <td>{f.Hours ?? t('common.notAvailable')}</td>
                  <td>
                    {f.Phone ? (
                      <a href={`tel:${f.Phone}`}>{f.Phone}</a>
                    ) : (
                      t('common.notAvailable')
                    )}
                  </td>
                  <td>{f.Capacity_Status ?? t('common.notAvailable')}</td>
                  <td>{f.ADA_Compliant ?? t('common.notAvailable')}</td>
                  <td>{f.Eligibility ?? t('common.notAvailable')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
