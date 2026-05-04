import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../LanguageSwitcher/LanguageSwitcher';
import styles from './Header.module.css';

export default function Header() {
  const { t } = useTranslation();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.title}>{t('app.title')}</span>
        </div>

        <nav className={styles.nav} aria-label={t('nav.ariaLabel')}>
          {/* role="list" restores list semantics in Safari when list-style:none is applied */}
          {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
          <ul className={styles.navList} role="list">
            <li>
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                }
                end
              >
                {t('nav.map')}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `${styles.navLink} ${styles.navLinkLogin} ${isActive ? styles.navLinkActive : ''}`
                }
              >
                {t('nav.staffLogin')}
              </NavLink>
            </li>
          </ul>
        </nav>

        <LanguageSwitcher />
      </div>
    </header>
  );
}
