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

  const isMobile =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  const { google, waze, apple } = buildDirectionUrls(dest, origin, isMobile);

  const services = [
    { key: 'google', href: google, label: t('directions.google') },
    { key: 'waze',   href: waze,   label: t('directions.waze')   },
    { key: 'apple',  href: apple,  label: t('directions.apple')  },
  ];

  return (
    <div className={styles.row}>
      {services.map(({ key, href, label }) => (
        <a
          key={key}
          href={href}
          className={styles.btn}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('directions.viaAria', { name: facilityName, service: label })}
        >
          {label}
        </a>
      ))}
    </div>
  );
}
