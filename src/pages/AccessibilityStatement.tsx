import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
        <p className={styles.updated}>Last reviewed: May 2026</p>

        <section aria-labelledby="commitment-heading">
          <h2 id="commitment-heading">Our Commitment</h2>
          <p>
            Douglas County Health Department is committed to ensuring the Douglas County
            Warming &amp; Cooling Centers application is accessible to everyone, including
            individuals with disabilities. We strive to conform to the{' '}
            <a
              href="https://www.w3.org/WAI/WCAG21/Understanding/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Web Content Accessibility Guidelines (WCAG) 2.1, Level AA
            </a>{' '}
            as required under applicable federal and state law, including Title II of the
            Americans with Disabilities Act (ADA).
          </p>
        </section>

        <section aria-labelledby="features-heading">
          <h2 id="features-heading">Accessibility Features</h2>
          <p>This application includes the following accessibility features:</p>
          <ul>
            <li>
              <strong>Keyboard navigation:</strong> All interactive elements—including map
              controls, navigation, the language switcher, and the staff portal—are fully
              operable via keyboard alone.
            </li>
            <li>
              <strong>Skip to main content:</strong> A "Skip to main content" link appears at
              the top of every page, allowing keyboard and screen reader users to bypass
              repetitive navigation.
            </li>
            <li>
              <strong>Screen reader support:</strong> The application uses semantic HTML,
              ARIA roles, labels, and live regions to communicate dynamic content changes to
              assistive technologies.
            </li>
            <li>
              <strong>Text alternatives:</strong> Status information (e.g., warming vs.
              cooling center, active vs. inactive) is conveyed through text labels, not color
              alone.
            </li>
            <li>
              <strong>Color contrast:</strong> Text and interactive elements meet or exceed
              the WCAG 2.1 AA minimum contrast ratio of 4.5:1 for normal text and 3:1 for
              large text.
            </li>
            <li>
              <strong>Accessible facility list:</strong> An accessible{' '}
              <Link to="/list">text-based facility list</Link> is available as an alternative
              to the interactive map, providing all active facility information in a
              structured, keyboard-navigable table.
            </li>
            <li>
              <strong>Multilingual support:</strong> The application is available in English,
              Spanish, Arabic, and Vietnamese, selectable via the language switcher in the
              header. Arabic is displayed right-to-left.
            </li>
            <li>
              <strong>Responsive design:</strong> The application works across desktop,
              tablet, and mobile devices.
            </li>
            <li>
              <strong>No auto-playing media:</strong> No audio or video content plays
              automatically.
            </li>
            <li>
              <strong>Consistent navigation:</strong> Navigation links are presented
              consistently across all pages.
            </li>
            <li>
              <strong>Visible focus indicators:</strong> Keyboard focus is clearly visible on
              all interactive elements.
            </li>
          </ul>
        </section>

        <section aria-labelledby="maps-heading">
          <h2 id="maps-heading">Interactive Map</h2>
          <p>
            The primary interface includes an interactive map powered by ArcGIS. While we
            have implemented keyboard controls and ARIA labels for map interactions, we
            recognize that interactive maps can present challenges for some users. The{' '}
            <Link to="/list">facility list page</Link> provides the same active-facility
            information in a fully accessible table format without requiring map interaction.
          </p>
        </section>

        <section aria-labelledby="feedback-heading">
          <h2 id="feedback-heading">Feedback &amp; Contact</h2>
          <p>
            We welcome feedback on the accessibility of this application. If you encounter
            any accessibility barriers or would like information in an alternative format,
            please contact us:
          </p>
          <ul>
            <li>
              <strong>Online contact form:</strong>{' '}
              <a href="https://contact.dogis.org/" target="_blank" rel="noopener noreferrer">
                contact.dogis.org
              </a>
            </li>
            <li>
              <strong>Douglas County Health Department</strong>
              <br />
              1111 S. 41st Street, Omaha, NE 68105
            </li>
          </ul>
          <p>We aim to respond to accessibility feedback within 2 business days.</p>
        </section>

        <section aria-labelledby="ada-heading">
          <h2 id="ada-heading">ADA Information</h2>
          <p>
            Douglas County Health Department is a public entity subject to Title II of the
            Americans with Disabilities Act of 1990 (ADA). Under Title II, no qualified
            individual with a disability shall, by reason of such disability, be excluded
            from participation in or be denied the benefits of the services, programs, or
            activities of a public entity.
          </p>
          <p>
            If you believe you have been discriminated against on the basis of a disability,
            you may file a complaint with the{' '}
            <a
              href="https://www.ada.gov/filing-a-complaint/"
              target="_blank"
              rel="noopener noreferrer"
            >
              U.S. Department of Justice ADA Information Line
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
