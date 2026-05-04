import { useEffect, useRef, useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { FacilityAttributes } from '../../types/facility';
import { getFacilityType } from '../../types/facility';
import { useTranslateContent } from '../../hooks/useTranslateContent';
import StatusBadge from '../common/StatusBadge';
import styles from './FacilityPopup.module.css';

interface CapacityConfig {
  icon: string;
  className: string;
  translationKey: 'capacity.available' | 'capacity.nearFull' | 'capacity.full';
  ariaKey: 'aria.capacityAvailable' | 'aria.capacityNearFull' | 'aria.capacityFull';
}

const CAPACITY_CONFIG: Partial<Record<string, CapacityConfig>> = {
  Available: {
    icon: '✓',
    className: styles.capacityAvailable,
    translationKey: 'capacity.available',
    ariaKey: 'aria.capacityAvailable',
  },
  'Near Full': {
    icon: '⚠',
    className: styles.capacityNearFull,
    translationKey: 'capacity.nearFull',
    ariaKey: 'aria.capacityNearFull',
  },
  Full: {
    icon: '✕',
    className: styles.capacityFull,
    translationKey: 'capacity.full',
    ariaKey: 'aria.capacityFull',
  },
};

function CapacityBadge({ status }: { status: string | null }) {
  const { t } = useTranslation();
  const { t: tMap } = useTranslation('map');
  if (!status) return <span className={styles.naText}>{t('common.notAvailable')}</span>;
  const config = CAPACITY_CONFIG[status];
  if (!config) return <span>{status}</span>;
  return (
    <span
      className={`${styles.capacityBadge} ${config.className}`}
      aria-label={tMap(config.ariaKey)}
    >
      <span className={styles.capacityIcon} aria-hidden="true">{config.icon}</span>
      <span>{tMap(config.translationKey)}</span>
    </span>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.infoRow}>
      <dt className={styles.infoLabel}>{label}</dt>
      <dd className={styles.infoValue}>{children}</dd>
    </div>
  );
}

export default function FacilityDetails({ facility }: { facility: FacilityAttributes }) {
  const { t, i18n } = useTranslation();
  const announcerId = useId();
  const [translationAnnouncement, setTranslationAnnouncement] = useState('');
  const prevLoadingRef = useRef(false);

  const type = getFacilityType(facility);
  const isActive = type !== 'inactive';
  const lang = i18n.language;

  const { translatedText: tName, isLoading: l1 } = useTranslateContent(facility.Name, lang);
  const { translatedText: tAddress, isLoading: l2 } = useTranslateContent(facility.Address, lang);
  const { translatedText: tHours, isLoading: l3 } = useTranslateContent(facility.Hours, lang);
  const { translatedText: tBusStop, isLoading: l4 } = useTranslateContent(facility.Nearest_Bus_Stop, lang);
  const { translatedText: tAda, isLoading: l5 } = useTranslateContent(facility.ADA_Compliant, lang);
  const { translatedText: tPet, isLoading: l6 } = useTranslateContent(facility.Pet_Accessibility, lang);
  const { translatedText: tLangSvcs, isLoading: l7 } = useTranslateContent(facility.Language_Services, lang);
  const { translatedText: tHydration, isLoading: l8 } = useTranslateContent(facility.Hydration, lang);
  const { translatedText: tEligibility, isLoading: l9 } = useTranslateContent(facility.Eligibility, lang);
  const { translatedText: tCapacityStatus } = useTranslateContent(facility.Capacity_Status, lang);

  const isTranslating = l1 || l2 || l3 || l4 || l5 || l6 || l7 || l8 || l9;

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isTranslating;
    if (isTranslating) {
      setTranslationAnnouncement(t('announcer.translating'));
    } else if (wasLoading) {
      setTranslationAnnouncement(t('announcer.translationComplete'));
    }
  }, [isTranslating, t]);

  const na = <span className={styles.naText}>{t('common.notAvailable')}</span>;
  const val = (text: string | null | undefined, translated: string) => (text ? translated : na);

  return (
    <>
      <div id={announcerId} aria-live="polite" aria-atomic="true" className={styles.srOnly}>
        {translationAnnouncement}
      </div>

      <div className={styles.badgeRow}>
        <StatusBadge type={type} isActive={isActive} />
        <CapacityBadge status={facility.Capacity_Status} />
      </div>

      <div className={styles.content}>
        <section aria-label={t('popup.sections.locationAccess')}>
          <h4 className={styles.sectionHeading}>{t('popup.sections.locationAccess')}</h4>
          <dl className={styles.dl}>
            <InfoRow label={t('facility.address')}>{val(facility.Address, tAddress)}</InfoRow>
            <InfoRow label={t('facility.nearestBusStop')}>{val(facility.Nearest_Bus_Stop, tBusStop)}</InfoRow>
          </dl>
        </section>

        <section aria-label={t('popup.sections.contact')}>
          <h4 className={styles.sectionHeading}>{t('popup.sections.contact')}</h4>
          <dl className={styles.dl}>
            <InfoRow label={t('facility.phone')}>
              {facility.Phone ? <a href={`tel:${facility.Phone}`} className={styles.link}>{facility.Phone}</a> : na}
            </InfoRow>
            <InfoRow label={t('facility.email')}>
              {facility.Email ? <a href={`mailto:${facility.Email}`} className={styles.link}>{facility.Email}</a> : na}
            </InfoRow>
            <InfoRow label={t('facility.website')}>
              {facility.Website ? (
                <a href={facility.Website} className={styles.link} target="_blank" rel="noopener noreferrer">
                  {facility.Website}
                  <span className={styles.srOnly}> ({t('aria.externalLink')})</span>
                </a>
              ) : na}
            </InfoRow>
          </dl>
        </section>

        <section aria-label={t('popup.sections.hoursCapacity')}>
          <h4 className={styles.sectionHeading}>{t('popup.sections.hoursCapacity')}</h4>
          <dl className={styles.dl}>
            <InfoRow label={t('facility.hours')}>{val(facility.Hours, tHours)}</InfoRow>
            <InfoRow label={t('facility.capacity')}>
              {facility.Capacity != null ? `${facility.Capacity} ${t('facility.spots')}` : na}
            </InfoRow>
            <InfoRow label={t('facility.capacityStatus')}>
              {facility.Capacity_Status ? (tCapacityStatus || facility.Capacity_Status) : na}
            </InfoRow>
          </dl>
        </section>

        <section aria-label={t('popup.sections.accessibilityServices')}>
          <h4 className={styles.sectionHeading}>{t('popup.sections.accessibilityServices')}</h4>
          <dl className={styles.dl}>
            <InfoRow label={t('facility.adaCompliant')}>{val(facility.ADA_Compliant, tAda)}</InfoRow>
            <InfoRow label={t('facility.petAccessibility')}>{val(facility.Pet_Accessibility, tPet)}</InfoRow>
            <InfoRow label={t('facility.chargingStations')}>{facility.Charging_Stations ?? na}</InfoRow>
            <InfoRow label={t('facility.languageServices')}>{val(facility.Language_Services, tLangSvcs)}</InfoRow>
            <InfoRow label={t('facility.hydration')}>{val(facility.Hydration, tHydration)}</InfoRow>
          </dl>
        </section>

        <section aria-label={t('popup.sections.eligibility')}>
          <h4 className={styles.sectionHeading}>{t('popup.sections.eligibility')}</h4>
          <p className={styles.eligibilityText}>
            {facility.Eligibility ? tEligibility : t('common.notAvailable')}
          </p>
        </section>
      </div>

      {tName && <span className={styles.srOnly}>{tName}</span>}
    </>
  );
}
