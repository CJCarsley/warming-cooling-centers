import { useTranslation } from 'react-i18next';
import { LEGEND_ITEMS } from './legendItems';
import styles from './MapLegend.module.css';

export default function MapLegend() {
  const { t } = useTranslation('map');

  return (
    <aside className={styles.legend} aria-label={t('legend.title')}>
      <h2 className={styles.title}>{t('legend.title')}</h2>
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
    </aside>
  );
}
