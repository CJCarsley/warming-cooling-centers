export const MAP_CONFIG = {
  centerLng: -95.94,
  centerLat: 41.26,
  zoom: 11,
  basemap: 'community',
  featureLayerUrl:
    'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0',
} as const;

/** RGB tuples used for SimpleMarkerSymbol colors */
export const SYMBOL_COLORS = {
  warming: [209, 75, 0] as [number, number, number],
  cooling: [21, 101, 192] as [number, number, number],
  dual: [106, 27, 154] as [number, number, number],
  inactive: [117, 117, 117] as [number, number, number],
} as const;

export const OUTFIELDS = [
  'OBJECTID',
  'Name',
  'Address',
  'Warming_Active',
  'Cooling_Active',
  'Hours',
  'Phone',
  'Email',
  'Website',
  'Nearest_Bus_Stop',
  'ADA_Compliant',
  'Pet_Accessibility',
  'Charging_Stations',
  'Language_Services',
  'Capacity',
  'Capacity_Status',
  'Hydration',
  'Eligibility',
] as const;
