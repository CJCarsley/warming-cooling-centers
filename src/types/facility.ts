export type EditStatusField = 'Warming_Active' | 'Cooling_Active';

export interface AdminFacility {
  ObjectID: number;
  Name: string;
  Address: string;
  Warming_Active: 'Yes' | 'No';
  Cooling_Active: 'Yes' | 'No';
  EditDate?: number | null;
}

export interface FacilityAttributes {
  ObjectID: number;
  Name: string;
  Address: string;
  Warming_Active: string;
  Cooling_Active: string;
  Hours: string | null;
  Phone: string | null;
  Email: string | null;
  Website: string | null;
  Nearest_Bus_Stop: string | null;
  ADA_Compliant: string | null;
  Pet_Accessibility: string | null;
  Charging_Stations: string | null;
  Language_Services: string | null;
  Capacity: number | null;
  Capacity_Status: string | null;
  Hydration: string | null;
  Eligibility: string | null;
}

export type FacilityType = 'warming' | 'cooling' | 'dual' | 'inactive';

export function getFacilityType(attrs: FacilityAttributes): FacilityType {
  const warm = attrs.Warming_Active === 'Yes';
  const cool = attrs.Cooling_Active === 'Yes';
  if (warm && cool) return 'dual';
  if (warm) return 'warming';
  if (cool) return 'cooling';
  return 'inactive';
}
