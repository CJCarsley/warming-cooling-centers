import { useEffect, useState } from 'react';
import type MapView from '@arcgis/core/views/MapView';
import type EsriMap from '@arcgis/core/Map';
import type Point from '@arcgis/core/geometry/Point';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer';
import UniqueValueRenderer from '@arcgis/core/renderers/UniqueValueRenderer';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import { MAP_CONFIG, OUTFIELDS } from '../config/map';
import type { FacilityAttributes } from '../types/facility';

function svgUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function flamePictureSymbol(): PictureMarkerSymbol {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 28">
    <path d="M12 2C12 2 5.5 9 5.5 15.5C5.5 20.2 8.3 24 12 24C15.7 24 18.5 20.2 18.5 15.5C18.5 12.5 16.5 10 15 8.5C15.2 10.5 13.5 12 12 13C10.5 12 9.2 10.5 9.2 8.5C9.2 8.5 12 5 12 2Z" fill="#D14B00" stroke="white" stroke-width="0.8"/>
  </svg>`;
  return new PictureMarkerSymbol({ url: svgUri(svg), width: 28, height: 28 });
}

function snowflakePictureSymbol(): PictureMarkerSymbol {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">
    <g stroke="#1565C0" stroke-linecap="round">
      <line x1="14" y1="2" x2="14" y2="26" stroke-width="3"/>
      <line x1="2" y1="14" x2="26" y2="14" stroke-width="3"/>
      <line x1="5.5" y1="5.5" x2="22.5" y2="22.5" stroke-width="3"/>
      <line x1="22.5" y1="5.5" x2="5.5" y2="22.5" stroke-width="3"/>
      <line x1="10.5" y1="4" x2="14" y2="7.5" stroke-width="2"/>
      <line x1="17.5" y1="4" x2="14" y2="7.5" stroke-width="2"/>
      <line x1="10.5" y1="24" x2="14" y2="20.5" stroke-width="2"/>
      <line x1="17.5" y1="24" x2="14" y2="20.5" stroke-width="2"/>
      <line x1="4" y1="10.5" x2="7.5" y2="14" stroke-width="2"/>
      <line x1="4" y1="17.5" x2="7.5" y2="14" stroke-width="2"/>
      <line x1="24" y1="10.5" x2="20.5" y2="14" stroke-width="2"/>
      <line x1="24" y1="17.5" x2="20.5" y2="14" stroke-width="2"/>
    </g>
    <circle cx="14" cy="14" r="3" fill="#1565C0"/>
  </svg>`;
  return new PictureMarkerSymbol({ url: svgUri(svg), width: 28, height: 28 });
}

function dualPictureSymbol(): PictureMarkerSymbol {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">
    <circle cx="14" cy="14" r="12" fill="#D14B00"/>
    <path d="M14 2A12 12 0 0 1 14 26Z" fill="#1565C0"/>
    <circle cx="14" cy="14" r="12" fill="none" stroke="white" stroke-width="1.5"/>
  </svg>`;
  return new PictureMarkerSymbol({ url: svgUri(svg), width: 28, height: 28 });
}

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
      { value: 'warming', symbol: flamePictureSymbol(), label: 'Warming Center' },
      { value: 'cooling', symbol: snowflakePictureSymbol(), label: 'Cooling Center' },
      { value: 'dual', symbol: dualPictureSymbol(), label: 'Warming & Cooling Center' },
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
      definitionExpression: "Warming_Active = 'Yes' OR Cooling_Active = 'Yes'",
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
