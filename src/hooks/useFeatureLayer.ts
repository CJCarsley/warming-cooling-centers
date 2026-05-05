import { useEffect, useState } from 'react';
import type MapView from '@arcgis/core/views/MapView';
import type EsriMap from '@arcgis/core/Map';
import type Point from '@arcgis/core/geometry/Point';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer';
import UniqueValueRenderer from '@arcgis/core/renderers/UniqueValueRenderer';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import { MAP_CONFIG, OUTFIELDS, SYMBOL_COLORS } from '../config/map';
import type { FacilityAttributes } from '../types/facility';

function buildRenderer(): UniqueValueRenderer {
  return new UniqueValueRenderer({
    valueExpression: `
      When(
        $feature.Warming_Active == "Yes" && $feature.Cooling_Active == "Yes", "dual",
        $feature.Warming_Active == "Yes", "warming",
        $feature.Cooling_Active == "Yes", "cooling",
        "inactive"
      )
    `,
    uniqueValueInfos: [
      {
        value: 'warming',
        symbol: new SimpleMarkerSymbol({
          style: 'circle',
          color: [...SYMBOL_COLORS.warming],
          size: '14px',
          outline: { color: [255, 255, 255, 1], width: 1.5 },
        }),
        label: 'Warming Center',
      },
      {
        value: 'cooling',
        symbol: new SimpleMarkerSymbol({
          style: 'diamond',
          color: [...SYMBOL_COLORS.cooling],
          size: '14px',
          outline: { color: [255, 255, 255, 1], width: 1.5 },
        }),
        label: 'Cooling Center',
      },
      {
        value: 'dual',
        symbol: new SimpleMarkerSymbol({
          style: 'square',
          color: [...SYMBOL_COLORS.dual],
          size: '14px',
          outline: { color: [255, 255, 255, 1], width: 1.5 },
        }),
        label: 'Warming & Cooling Center',
      },
      {
        value: 'inactive',
        symbol: new SimpleMarkerSymbol({
          style: 'triangle',
          color: [...SYMBOL_COLORS.inactive],
          size: '12px',
          outline: { color: [255, 255, 255, 1], width: 1.5 },
        }),
        label: 'Closed / Inactive',
      },
    ],
  });
}

export interface FacilityWithLocation {
  attributes: FacilityAttributes;
  longitude: number;
  latitude: number;
}

export interface UseFeatureLayerResult {
  layer: FeatureLayer | null;
  facilities: FacilityAttributes[];
  facilitiesWithLocation: FacilityWithLocation[];
}

export function useFeatureLayer(view: MapView | null): UseFeatureLayerResult {
  const [layer, setLayer] = useState<FeatureLayer | null>(null);
  const [facilities, setFacilities] = useState<FacilityAttributes[]>([]);
  const [facilitiesWithLocation, setFacilitiesWithLocation] = useState<FacilityWithLocation[]>([]);

  useEffect(() => {
    if (!view) return;

    const esriMap = view.map as EsriMap;

    const featureLayer = new FeatureLayer({
      url: MAP_CONFIG.featureLayerUrl,
      outFields: [...OUTFIELDS],
      renderer: buildRenderer(),
      popupEnabled: false,
    });

    esriMap.add(featureLayer);
    setLayer(featureLayer);

    const loadData = async () => {
      await featureLayer.load();
      const result = await featureLayer.queryFeatures({
        where: '1=1',
        outFields: [...OUTFIELDS],
        returnGeometry: true,
        outSpatialReference: new SpatialReference({ wkid: 4326 }),
      });
      const attrs = result.features.map((f) => f.attributes as FacilityAttributes);
      setFacilities(attrs);
      setFacilitiesWithLocation(
        result.features
          .filter((f) => f.geometry?.type === 'point')
          .map((f) => {
            const pt = f.geometry as Point;
            return {
              attributes: f.attributes as FacilityAttributes,
              longitude: pt.x,
              latitude: pt.y,
            };
          }),
      );
    };

    void loadData().catch((err: unknown) => {
      console.error('Failed to load/query feature layer:', err);
    });

    return () => {
      if (!view.destroyed) {
        esriMap.remove(featureLayer);
      }
      setLayer(null);
      setFacilities([]);
      setFacilitiesWithLocation([]);
    };
  }, [view]);

  return { layer, facilities, facilitiesWithLocation };
}
