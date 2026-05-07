import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { buildDirectionUrls } from '../../utils/directions';
import styles from './DirectionsButtons.module.css';

interface DirectionsButtonsProps {
  dest: { latitude: number; longitude: number };
  origin?: { latitude: number; longitude: number } | null;
  facilityName: string;
}

export default function DirectionsButtons({ dest, origin, facilityName }: DirectionsButtonsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isMobile =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  const { google, waze, apple } = buildDirectionUrls(dest, origin, isMobile);

  const services = [
    { key: 'google', href: google, label: t('directions.google') },
    { key: 'waze',   href: waze,   label: t('directions.waze')   },
    { key: 'apple',  href: apple,  label: t('directions.apple')  },
  ];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open]);

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={styles.btn}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t('popup.getDirectionsAria', { name: facilityName })}
      >
        {t('popup.getDirections')}
        <span className={styles.caret} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className={styles.menu} role="listbox" aria-label={t('directions.chooseApp')}>
          {services.map(({ key, href, label }) => (
            <a
              key={key}
              href={href}
              className={styles.menuItem}
              target="_blank"
              rel="noopener noreferrer"
              role="option"
              aria-selected={false}
              onClick={() => setOpen(false)}
              aria-label={t('directions.viaAria', { name: facilityName, service: label })}
            >
              {label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
