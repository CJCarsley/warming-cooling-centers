import { useTranslation } from 'react-i18next';
import styles from './SkipLink.module.css';

export default function SkipLink() {
  const { t } = useTranslation();

  return (
    <a href="#main-content" className={styles.skipLink}>
      {t('skipLink.label')}
    </a>
  );
}
