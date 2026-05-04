import { useTranslation } from 'react-i18next';
import styles from './Footer.module.css';

export default function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.disclaimer}>{t('footer.disclaimer')}</p>
        <div className={styles.links}>
          <a href="/accessibility" className={styles.link}>
            {t('footer.accessibilityStatement')}
          </a>
          <a href="/contact" className={styles.link}>
            {t('footer.contact')}
          </a>
        </div>
        <p className={styles.copyright}>
          {t('footer.copyright', { year })}
        </p>
      </div>
    </footer>
  );
}
