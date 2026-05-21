import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import styles from './AccessibilityStatement.module.css';

export default function AccessibilityStatement() {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.backLink}>
          ← {t('admin.login.backToMap')}
        </Link>

        <h1 className={styles.heading}>{t('footer.accessibilityStatement')}</h1>
        <p className={styles.updated}>{t('accessibility.lastReviewed')}</p>

        <section aria-labelledby="commitment-heading">
          <h2 id="commitment-heading">{t('accessibility.commitment.heading')}</h2>
          <p>
            <Trans
              i18nKey="accessibility.commitment.body"
              components={{
                wcag: (
                  <a
                    href="https://www.w3.org/WAI/WCAG21/Understanding/"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                ),
              }}
            />
          </p>
        </section>

        <section aria-labelledby="features-heading">
          <h2 id="features-heading">{t('accessibility.features.heading')}</h2>
          <p>{t('accessibility.features.intro')}</p>
          <ul>
            <li>
              <strong>{t('accessibility.features.items.keyboardLabel')}</strong>{' '}
              {t('accessibility.features.items.keyboardText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.skipLinkLabel')}</strong>{' '}
              {t('accessibility.features.items.skipLinkText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.screenReaderLabel')}</strong>{' '}
              {t('accessibility.features.items.screenReaderText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.textAltLabel')}</strong>{' '}
              {t('accessibility.features.items.textAltText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.contrastLabel')}</strong>{' '}
              {t('accessibility.features.items.contrastText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.facilityListLabel')}</strong>{' '}
              <Trans
                i18nKey="accessibility.features.items.facilityListText"
                components={{ list: <Link to="/list" /> }}
              />
            </li>
            <li>
              <strong>{t('accessibility.features.items.multilingualLabel')}</strong>{' '}
              {t('accessibility.features.items.multilingualText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.responsiveLabel')}</strong>{' '}
              {t('accessibility.features.items.responsiveText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.noAutoplayLabel')}</strong>{' '}
              {t('accessibility.features.items.noAutoplayText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.consistentNavLabel')}</strong>{' '}
              {t('accessibility.features.items.consistentNavText')}
            </li>
            <li>
              <strong>{t('accessibility.features.items.focusLabel')}</strong>{' '}
              {t('accessibility.features.items.focusText')}
            </li>
          </ul>
        </section>

        <section aria-labelledby="maps-heading">
          <h2 id="maps-heading">{t('accessibility.map.heading')}</h2>
          <p>
            <Trans
              i18nKey="accessibility.map.body"
              components={{ list: <Link to="/list" /> }}
            />
          </p>
        </section>

        <section aria-labelledby="feedback-heading">
          <h2 id="feedback-heading">{t('accessibility.feedback.heading')}</h2>
          <p>{t('accessibility.feedback.body')}</p>
          <ul>
            <li>
              <strong>{t('accessibility.feedback.contactFormLabel')}</strong>{' '}
              <a href="https://contact.dogis.org/" target="_blank" rel="noopener noreferrer">
                contact.dogis.org
              </a>
            </li>
            <li>
              <strong>{t('accessibility.feedback.departmentName')}</strong>
              <br />
              {t('accessibility.feedback.departmentAddress')}
            </li>
          </ul>
          <p>{t('accessibility.feedback.responseTime')}</p>
        </section>

        <section aria-labelledby="ada-heading">
          <h2 id="ada-heading">{t('accessibility.ada.heading')}</h2>
          <p>{t('accessibility.ada.body1')}</p>
          <p>
            <Trans
              i18nKey="accessibility.ada.body2"
              components={{
                doj: (
                  <a
                    href="https://www.ada.gov/filing-a-complaint/"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                ),
              }}
            />
          </p>
        </section>
      </div>
    </div>
  );
}
