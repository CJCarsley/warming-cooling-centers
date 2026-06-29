import { useEffect, useRef, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FacilityAttributes } from '../../types/facility';
import { getFacilityType } from '../../types/facility';
import { useTranslateContent } from '../../hooks/useTranslateContent';
import StatusBadge from '../common/StatusBadge';
import DirectionsButtons from '../common/DirectionsButtons';
import PopupSections from './PopupSections';
import EligibilityFlag from './EligibilityFlag';
import styles from './FacilityPopup.module.css';

interface FacilityPopupProps {
  facility: FacilityAttributes;
  facilityLocation: { latitude: number; longitude: number };
  originPoint?: { latitude: number; longitude: number } | null;
  onClose: () => void;
}

export default function FacilityPopup({ facility, facilityLocation, originPoint, onClose }: FacilityPopupProps) {
  const { t, i18n } = useTranslation();
  const { t: tMap } = useTranslation('map');
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const announcerId = useId();
  const descriptionId = useId();
  const [translationAnnouncement, setTranslationAnnouncement] = useState('');
  const prevLoadingRef = useRef(false);

  const type = getFacilityType(facility);
  const isActive = type !== 'inactive';
  const lang = i18n.language;
  const hasEligibility = !!facility.Eligibility?.trim();

  const TYPE_STATUS_LABELS: Record<string, string> = {
    warming: tMap('aria.warmingCenter'),
    cooling: tMap('aria.coolingCenter'),
    dual: tMap('aria.dualCenter'),
    inactive: tMap('aria.inactiveCenter'),
  };
  const dialogDescription = [
    TYPE_STATUS_LABELS[type] ?? '',
    facility.Address ?? '',
  ].filter(Boolean).join(' — ');

  // Facility name is translated for the header; the section field values are
  // translated inside PopupSections (one hook per field).
  const { translatedText: tName, isLoading: isTranslating } =
    useTranslateContent(facility.Name, lang);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isTranslating;
    if (isTranslating) {
      setTranslationAnnouncement(t('announcer.translating'));
    } else if (wasLoading) {
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

    // Focus the dialog heading first so AT announces the facility name on open
    headingRef.current?.focus();

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

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        className={styles.dialog}
      >
        {/* Static description read by AT when dialog opens */}
        <div id={descriptionId} className={styles.srOnly}>
          {dialogDescription}
        </div>

        {/* Translation state announcer — separate live region, not used as describedby */}
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
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className={styles.facilityName}
          >
            {tName || facility.Name}
          </h2>
          {hasEligibility && <EligibilityFlag eligibility={facility.Eligibility!} />}
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
        </div>

        {/* Get Directions */}
        <div className={styles.directionsRow}>
          <DirectionsButtons
            dest={facilityLocation}
            origin={originPoint}
            facilityName={facility.Name}
          />
        </div>

        {/* Scrollable, admin-configurable content */}
        <PopupSections facility={facility} headingLevel="h3" />
      </div>
    </>
  );
}
