import { useTranslation } from 'react-i18next';
import type { FacilityType } from '../../types/facility';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  type: FacilityType;
  isActive: boolean;
}

const TYPE_ICON: Record<FacilityType, string> = {
  warming: '☀',
  cooling: '❄',
  dual: '⊕',
  inactive: '△',
};

const FACILITY_TYPE_KEYS: Record<FacilityType, string> = {
  warming: 'facilityType.warming',
  cooling: 'facilityType.cooling',
  dual: 'facilityType.dual',
  inactive: 'facilityType.inactive',
};

export default function StatusBadge({ type, isActive }: StatusBadgeProps) {
  const { t } = useTranslation();
  const { t: tMap } = useTranslation('map');

  const typeLabel = tMap(FACILITY_TYPE_KEYS[type]);
  const statusLabel = isActive ? t('status.open') : t('status.closed');

  return (
    <span
      className={`${styles.badge} ${styles[type]}`}
      aria-label={`${typeLabel} — ${statusLabel}`}
    >
      <span className={styles.icon} aria-hidden="true">
        {TYPE_ICON[type]}
      </span>
      <span className={styles.label}>{typeLabel}</span>
      <span className={styles.status}>{statusLabel}</span>
    </span>
  );
}
