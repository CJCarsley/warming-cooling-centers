import type { FacilityAttributes } from '../../types/facility';
import { getFacilityType } from '../../types/facility';
import StatusBadge from '../common/StatusBadge';
import DirectionsButtons from '../common/DirectionsButtons';
import PopupSections, { CapacityBadge } from './PopupSections';
import styles from './FacilityPopup.module.css';

interface FacilityDetailsProps {
  facility: FacilityAttributes;
  facilityLocation?: { latitude: number; longitude: number };
  originPoint?: { latitude: number; longitude: number } | null;
}

export default function FacilityDetails({ facility, facilityLocation, originPoint }: FacilityDetailsProps) {
  const type = getFacilityType(facility);
  const isActive = type !== 'inactive';

  return (
    <>
      <div className={styles.badgeRow}>
        <StatusBadge type={type} isActive={isActive} />
        <CapacityBadge status={facility.Capacity_Status} />
      </div>

      {facilityLocation && (
        <div className={styles.directionsRow}>
          <DirectionsButtons
            dest={facilityLocation}
            origin={originPoint}
            facilityName={facility.Name}
          />
        </div>
      )}

      <PopupSections facility={facility} headingLevel="h4" />
    </>
  );
}
