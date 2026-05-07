import { useTranslation } from 'react-i18next';
import styles from './MapLegend.module.css';

const LEGEND_ITEMS = [
  { key: 'warming', shapeClass: 'circle', colorClass: 'colorWarming' },
  { key: 'cooling', shapeClass: 'diamond', colorClass: 'colorCooling' },
  { key: 'inactive', shapeClass: 'triangle', colorClass: 'colorInactive' },
] as const;

export default function MapLegend() {
  const { t } = useTranslation('map');

  return (
    <aside className={styles.legend} aria-label={t('legend.title')}>
      <h2 className={styles.title}>{t('legend.title')}</h2>
      {/* role="list" restores list semantics in Safari when list-style:none is applied */}
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
      <ul className={styles.list} role="list">
        {LEGEND_ITEMS.map(({ key, shapeClass, colorClass }) => (
          <li key={key} className={styles.item}>
            <span
              className={`${styles.symbol} ${styles[shapeClass]} ${styles[colorClass]}`}
              aria-hidden="true"
            />
            <span className={styles.itemLabel}>{t(`legend.${key}`)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
