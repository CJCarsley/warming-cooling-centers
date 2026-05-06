import { useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { NearbyResult } from '../../hooks/useNearby';
import FacilityDetails from './FacilityDetails';
import styles from './NearbyPanel.module.css';

interface NearbyPanelProps {
  results: NearbyResult[];
  originPoint?: { latitude: number; longitude: number } | null;
  onClose: () => void;
}

function formatDist(mi: number): string {
  if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
  return `${mi.toFixed(1)} mi`;
}

export default function NearbyPanel({ results, originPoint, onClose }: NearbyPanelProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!results.length) return null;

  return (
    <div className={styles.panel} role="region" aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.title}>
          {t('nearby.heading')}
        </h2>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label={t('nearby.close')}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
      <ul className={styles.list} role="list">
        {results.map((r, i) => {
          const isOpen = expandedIdx === i;
          const btnId = `${headingId}-btn-${i}`;
          const detailId = `${headingId}-detail-${i}`;

          return (
            <li key={r.facility.attributes.ObjectID} className={styles.item}>
              <button
                id={btnId}
                type="button"
                className={styles.itemBtn}
                aria-expanded={isOpen}
                aria-controls={detailId}
                onClick={() => setExpandedIdx(isOpen ? null : i)}
              >
                <span className={styles.rank} aria-hidden="true">{i + 1}</span>
                <span className={styles.name}>{r.facility.attributes.Name}</span>
                <span className={styles.dist} aria-label={t('nearby.distanceAria', { dist: formatDist(r.distanceMi) })}>
                  {formatDist(r.distanceMi)}
                </span>
                <span
                  className={`${styles.arrow} ${isOpen ? styles.arrowOpen : ''}`}
                  aria-hidden="true"
                >
                  ›
                </span>
              </button>

              {isOpen && (
                <div
                  id={detailId}
                  role="region"
                  aria-labelledby={btnId}
                  className={styles.detail}
                >
                  <FacilityDetails
                    facility={r.facility.attributes}
                    facilityLocation={{ latitude: r.facility.latitude, longitude: r.facility.longitude }}
                    originPoint={originPoint}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
