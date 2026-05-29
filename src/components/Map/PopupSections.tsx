import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { FacilityAttributes } from '../../types/facility';
import { useTranslateContent } from '../../hooks/useTranslateContent';
import { usePopupConfig } from '../../hooks/usePopupConfig';
import { DEFAULT_POPUP_LAYOUT, FIELD_LABEL_KEYS } from '../../utils/popupConfig';
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

export function CapacityBadge({ status }: { status: string | null }) {
  const { t } = useTranslation();
  const { t: tMap } = useTranslation('map');
  if (!status) return <span className={styles.naText}>{t('common.notAvailable')}</span>;
  const config = CAPACITY_CONFIG[status];
  if (!config) return <span>{status}</span>;
  return (
    <span className={`${styles.capacityBadge} ${config.className}`} aria-label={tMap(config.ariaKey)}>
      <span className={styles.capacityIcon} aria-hidden="true">{config.icon}</span>
      <span>{tMap(config.translationKey)}</span>
    </span>
  );
}

// One component instance per field so useTranslateContent is called once per
// field in a stable order (config-driven loops must not call hooks inline).
function PopupFieldRow({ fieldName, facility }: { fieldName: string; facility: FacilityAttributes }) {
  const { t, i18n } = useTranslation();
  const raw = facility[fieldName as keyof FacilityAttributes];
  const text = raw == null ? '' : String(raw);
  const { translatedText } = useTranslateContent(text, i18n.language);

  const labelKey = FIELD_LABEL_KEYS[fieldName];
  const label = labelKey ? t(labelKey) : fieldName;
  const na = <span className={styles.naText}>{t('common.notAvailable')}</span>;

  let value: React.ReactNode;
  switch (fieldName) {
    case 'Phone':
      value = text ? <a href={`tel:${text}`} className={styles.link}>{text}</a> : na;
      break;
    case 'Email':
      value = text ? <a href={`mailto:${text}`} className={styles.link}>{text}</a> : na;
      break;
    case 'Website':
      value = text ? (
        <a href={text} className={styles.link} target="_blank" rel="noopener noreferrer">
          {text}
          <span className={styles.srOnly}> ({t('aria.externalLink')})</span>
        </a>
      ) : na;
      break;
    case 'Capacity':
      value = raw != null && raw !== '' ? `${raw} ${t('facility.spots')}` : na;
      break;
    case 'Capacity_Status':
      value = <CapacityBadge status={text || null} />;
      break;
    default:
      value = text ? translatedText : na;
  }

  return (
    <div className={styles.infoRow}>
      <dt className={styles.infoLabel}>{label}</dt>
      <dd className={styles.infoValue}>{value}</dd>
    </div>
  );
}

interface PopupSectionsProps {
  facility: FacilityAttributes;
  headingLevel: 'h3' | 'h4';
}

export default function PopupSections({ facility, headingLevel: H }: PopupSectionsProps) {
  const { t } = useTranslation();
  const saved = usePopupConfig();
  const idPrefix = useId();

  // Saved layout (literal titles) wins; otherwise the translated default layout.
  const sections =
    saved.length > 0
      ? saved.map((s) => ({ title: s.title, fields: s.fields }))
      : DEFAULT_POPUP_LAYOUT.map((s) => ({ title: t(s.titleKey), fields: s.fields }));

  return (
    <div className={styles.content}>
      {sections.map((section, i) => {
        const headingId = `${idPrefix}-sec-${i}`;
        return (
          <section key={headingId} aria-labelledby={headingId}>
            <H id={headingId} className={styles.sectionHeading}>{section.title}</H>
            <dl className={styles.dl}>
              {section.fields.map((name) => (
                <PopupFieldRow key={name} fieldName={name} facility={facility} />
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
