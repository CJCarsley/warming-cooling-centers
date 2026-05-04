import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './LanguageSwitcher.module.css';

const LANGUAGES = [
  { code: 'en', nativeName: 'English', labelKey: 'language.english' as const },
  { code: 'es', nativeName: 'Español', labelKey: 'language.spanish' as const },
  { code: 'vi', nativeName: 'Tiếng Việt', labelKey: 'language.vietnamese' as const },
  { code: 'ar', nativeName: 'العربية', labelKey: 'language.arabic' as const },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [announcement, setAnnouncement] = useState('');
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value;
    const entry = LANGUAGES.find((l) => l.code === lang);
    const nativeName = entry?.nativeName ?? lang;

    void i18n.changeLanguage(lang).then(() => {
      // Use i18n.t() directly so the message is in the newly active language
      const msg = i18n.t('language.changed', { language: nativeName });
      setAnnouncement(msg);

      // Clear after 4 s to prevent stale announcements re-reading
      if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
      announcementTimerRef.current = setTimeout(() => setAnnouncement(''), 4000);
    });
  };

  // Normalize codes like "en-US" → "en"
  const currentLang = i18n.language.split('-')[0];

  return (
    <div className={styles.wrapper}>
      {/* Polite live region — announces in the newly selected language */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      >
        {announcement}
      </div>

      <label htmlFor="language-select" className={styles.label}>
        {/* Show native label of current language */}
        {LANGUAGES.find((l) => l.code === currentLang)?.nativeName ?? 'Language'}
      </label>
      <select
        id="language-select"
        className={styles.select}
        value={currentLang}
        onChange={handleChange}
      >
        {LANGUAGES.map(({ code, nativeName }) => (
          <option key={code} value={code} lang={code}>
            {nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
