import { useTranslation } from 'react-i18next';
import type { FacilityAttributes } from '../../types/facility';
import { getFacilityType } from '../../types/facility';
import StatusBadge from '../common/StatusBadge';
import styles from './FacilityCard.module.css';

interface FacilityCardProps {
  facility: FacilityAttributes;
}

export default function FacilityCard({ facility }: FacilityCardProps) {
  const { t } = useTranslation();
  const type = getFacilityType(facility);
  const isActive = type !== 'inactive';

  return (
    <article className={styles.card} aria-label={facility.Name}>
      <header className={styles.cardHeader}>
        <h3 className={styles.name}>{facility.Name}</h3>
        <StatusBadge type={type} isActive={isActive} />
      </header>

      {facility.Address && (
        <p className={styles.address}>
          <span className={styles.fieldLabel}>{t('facility.address')}: </span>
          {facility.Address}
        </p>
      )}

      {facility.Hours && (
        <p className={styles.field}>
          <span className={styles.fieldLabel}>{t('facility.hours')}: </span>
          {facility.Hours}
        </p>
      )}

      {facility.Phone && (
        <p className={styles.field}>
          <span className={styles.fieldLabel}>{t('facility.phone')}: </span>
          <a href={`tel:${facility.Phone}`} className={styles.link}>
            {facility.Phone}
          </a>
        </p>
      )}

      {facility.Capacity_Status && (
        <p className={styles.field}>
          <span className={styles.fieldLabel}>{t('facility.capacityStatus')}: </span>
          {facility.Capacity_Status}
        </p>
      )}
    </article>
  );
}
