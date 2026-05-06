import { useEffect, useRef, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FacilityAttributes } from '../../types/facility';
import { getFacilityType } from '../../types/facility';
import { useTranslateContent } from '../../hooks/useTranslateContent';
import StatusBadge from '../common/StatusBadge';
import styles from './FacilityPopup.module.css';

interface FacilityPopupProps {
  facility: FacilityAttributes;
  facilityLocation: { latitude: number; longitude: number };
  originPoint?: { latitude: number; longitude: number } | null;
  onClose: () => void;
}

function buildDirectionsUrl(
  dest: { latitude: number; longitude: number },
  origin: { latitude: number; longitude: number } | null | undefined,
  isMobile: boolean,
): string {
  const d = `${dest.latitude},${dest.longitude}`;
  if (isMobile) {
    return `https://maps.google.com/maps?daddr=${d}&dirflg=d`;
  }
  if (origin) {
    const o = `${origin.latitude},${origin.longitude}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=driving`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=driving`;
}

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

  if (!status)
    return <span className={styles.naText}>{t('common.notAvailable')}</span>;

  const config = CAPACITY_CONFIG[status];
  if (!config) return <span>{status}</span>;

  return (
    <span
      className={`${styles.capacityBadge} ${config.className}`}
      aria-label={tMap(config.ariaKey)}
    >
      <span className={styles.capacityIcon} aria-hidden="true">
        {config.icon}
      </span>
      <span>{tMap(config.translationKey)}</span>
    </span>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.infoRow}>
      <dt className={styles.infoLabel}>{label}</dt>
      <dd className={styles.infoValue}>{children}</dd>
    </div>
  );
}

export default function FacilityPopup({ facility, facilityLocation, originPoint, onClose }: FacilityPopupProps) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const announcerId = useId();
  const [translationAnnouncement, setTranslationAnnouncement] = useState('');
  const prevLoadingRef = useRef(false);

  const type = getFacilityType(facility);
  const isActive = type !== 'inactive';
  const lang = i18n.language;

  const isMobile = typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const directionsUrl = buildDirectionsUrl(facilityLocation, originPoint, isMobile);

  // ── Dynamic field translation ─────────────────────────────────────────────
  // Each hook call is for one translatable field value from ArcGIS.
  // Phone, Email, and Website are intentionally excluded (data values that
  // must not be altered). In Phase 5, replace the pass-through in
  // useTranslateContent with the AWS Translate Lambda call — no changes
  // needed here.
  //
  // Note for Phase 5: consider batching these into a single Lambda request
  // to reduce round-trips. The cache in useTranslateContent will prevent
  // redundant calls for previously translated strings.
  const { translatedText: tName, isLoading: l1 } =
    useTranslateContent(facility.Name, lang);
  const { translatedText: tAddress, isLoading: l2 } =
    useTranslateContent(facility.Address, lang);
  const { translatedText: tHours, isLoading: l3 } =
    useTranslateContent(facility.Hours, lang);
  const { translatedText: tBusStop, isLoading: l4 } =
    useTranslateContent(facility.Nearest_Bus_Stop, lang);
  const { translatedText: tAda, isLoading: l5 } =
    useTranslateContent(facility.ADA_Compliant, lang);
  const { translatedText: tPet, isLoading: l6 } =
    useTranslateContent(facility.Pet_Accessibility, lang);
  const { translatedText: tLangSvcs, isLoading: l7 } =
    useTranslateContent(facility.Language_Services, lang);
  const { translatedText: tHydration, isLoading: l8 } =
    useTranslateContent(facility.Hydration, lang);
  const { translatedText: tEligibility, isLoading: l9 } =
    useTranslateContent(facility.Eligibility, lang);
  const { translatedText: tCapacityStatus, isLoading: l10 } =
    useTranslateContent(facility.Capacity_Status, lang);

  const isTranslating = l1 || l2 || l3 || l4 || l5 || l6 || l7 || l8 || l9 || l10;

  // ── Translation state announcer ───────────────────────────────────────────
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isTranslating;

    if (isTranslating) {
      setTranslationAnnouncement(t('announcer.translating'));
    } else if (wasLoading) {
      // Only announce "complete" on the loading→done transition
      setTranslationAnnouncement(t('announcer.translationComplete'));
    }
  }, [isTranslating, t]);

  // ── Focus trap + Escape handler ───────────────────────────────────────────
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const getFocusable = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));

    getFocusable()[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = getFocusable();
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const na = <span className={styles.naText}>{t('common.notAvailable')}</span>;
  const val = (text: string | null | undefined, translated: string) =>
    text ? translated : na;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={announcerId}
        className={styles.dialog}
      >
        {/* Translation state announcer */}
        <div
          id={announcerId}
          aria-live="polite"
          aria-atomic="true"
          className={styles.srOnly}
        >
          {translationAnnouncement}
        </div>

        {/* Header */}
        <div className={styles.dialogHeader}>
          <h2 id={headingId} className={styles.facilityName}>
            {tName || facility.Name}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={t('popup.closeAria', { name: facility.Name })}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/* Status badges */}
        <div className={styles.badgeRow}>
          <StatusBadge type={type} isActive={isActive} />
          <CapacityBadge status={facility.Capacity_Status} />
        </div>

        {/* Get Directions */}
        <div className={styles.directionsRow}>
          <a
            href={directionsUrl}
            className={styles.directionsButton}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('popup.getDirectionsAria', { name: facility.Name })}
          >
            <span aria-hidden="true">↗</span>
            {t('popup.getDirections')}
          </a>
        </div>

        {/* Scrollable content */}
        <div className={styles.content}>

          {/* Location & Access */}
          <section aria-labelledby={`${headingId}-loc`}>
            <h3 id={`${headingId}-loc`} className={styles.sectionHeading}>
              {t('popup.sections.locationAccess')}
            </h3>
            <dl className={styles.dl}>
              <InfoRow label={t('facility.address')}>
                {val(facility.Address, tAddress)}
              </InfoRow>
              <InfoRow label={t('facility.nearestBusStop')}>
                {val(facility.Nearest_Bus_Stop, tBusStop)}
              </InfoRow>
            </dl>
          </section>

          {/* Contact — Phone/Email/Website are NOT translated */}
          <section aria-labelledby={`${headingId}-contact`}>
            <h3
              id={`${headingId}-contact`}
              className={styles.sectionHeading}
            >
              {t('popup.sections.contact')}
            </h3>
            <dl className={styles.dl}>
              <InfoRow label={t('facility.phone')}>
                {facility.Phone ? (
                  <a href={`tel:${facility.Phone}`} className={styles.link}>
                    {facility.Phone}
                  </a>
                ) : (
                  na
                )}
              </InfoRow>
              <InfoRow label={t('facility.email')}>
                {facility.Email ? (
                  <a
                    href={`mailto:${facility.Email}`}
                    className={styles.link}
                  >
                    {facility.Email}
                  </a>
                ) : (
                  na
                )}
              </InfoRow>
              <InfoRow label={t('facility.website')}>
                {facility.Website ? (
                  <a
                    href={facility.Website}
                    className={styles.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {facility.Website}
                    <span className={styles.srOnly}>
                      {' '}({t('aria.externalLink')})
                    </span>
                  </a>
                ) : (
                  na
                )}
              </InfoRow>
            </dl>
          </section>

          {/* Hours & Capacity */}
          <section aria-labelledby={`${headingId}-hours`}>
            <h3
              id={`${headingId}-hours`}
              className={styles.sectionHeading}
            >
              {t('popup.sections.hoursCapacity')}
            </h3>
            <dl className={styles.dl}>
              <InfoRow label={t('facility.hours')}>
                {val(facility.Hours, tHours)}
              </InfoRow>
              <InfoRow label={t('facility.capacity')}>
                {facility.Capacity != null
                  ? `${facility.Capacity} ${t('facility.spots')}`
                  : na}
              </InfoRow>
              <InfoRow label={t('facility.capacityStatus')}>
                {facility.Capacity_Status
                  ? (tCapacityStatus || facility.Capacity_Status)
                  : na}
              </InfoRow>
            </dl>
          </section>

          {/* Accessibility & Services */}
          <section aria-labelledby={`${headingId}-access`}>
            <h3
              id={`${headingId}-access`}
              className={styles.sectionHeading}
            >
              {t('popup.sections.accessibilityServices')}
            </h3>
            <dl className={styles.dl}>
              <InfoRow label={t('facility.adaCompliant')}>
                {val(facility.ADA_Compliant, tAda)}
              </InfoRow>
              <InfoRow label={t('facility.petAccessibility')}>
                {val(facility.Pet_Accessibility, tPet)}
              </InfoRow>
              <InfoRow label={t('facility.chargingStations')}>
                {facility.Charging_Stations ?? na}
              </InfoRow>
              <InfoRow label={t('facility.languageServices')}>
                {val(facility.Language_Services, tLangSvcs)}
              </InfoRow>
              <InfoRow label={t('facility.hydration')}>
                {val(facility.Hydration, tHydration)}
              </InfoRow>
            </dl>
          </section>

          {/* Eligibility */}
          <section aria-labelledby={`${headingId}-elig`}>
            <h3
              id={`${headingId}-elig`}
              className={styles.sectionHeading}
            >
              {t('popup.sections.eligibility')}
            </h3>
            <p className={styles.eligibilityText}>
              {facility.Eligibility ? tEligibility : t('common.notAvailable')}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
