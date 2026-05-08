import { useState, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LEGEND_ITEMS } from './legendItems';
import styles from './MobileLegendOverlay.module.css';

const STORAGE_KEY = 'legend-expanded';

function getInitialExpanded(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export default function MobileLegendOverlay() {
  const { t } = useTranslation('map');
  const contentId = useId();
  const [isExpanded, setIsExpanded] = useState(getInitialExpanded);

  const toggle = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  return (
    <div
      className={styles.overlay}
      role="complementary"
      aria-label={t('legend.title')}
    >
      <button
        type="button"
        className={styles.toggleBtn}
        onClick={toggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        aria-label={t('legend.toggleAria')}
      >
        <span>{t('legend.title')}</span>
        <span
          className={`${styles.chevron} ${isExpanded ? styles.chevronUp : ''}`}
          aria-hidden="true"
        />
      </button>

      <div
        id={contentId}
        className={`${styles.content} ${isExpanded ? styles.contentExpanded : ''}`}
        aria-hidden={!isExpanded}
      >
        {/* role="list" restores list semantics in Safari when list-style:none is applied */}
        {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
        <ul className={styles.list} role="list">
          {LEGEND_ITEMS.map(({ key, Icon }) => (
            <li key={key} className={styles.item}>
              <span className={styles.symbol} aria-hidden="true">
                <Icon />
              </span>
              <span className={styles.itemLabel}>{t(`legend.${key}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
