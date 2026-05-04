import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enUI from './en.json';
import enMap from './en.map.json';
import esUI from './es.json';
import esMap from './es.map.json';
import viUI from './vi.json';
import viMap from './vi.map.json';
import arUI from './ar.json';
import arMap from './ar.map.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enUI, map: enMap },
      es: { translation: esUI, map: esMap },
      vi: { translation: viUI, map: viMap },
      ar: { translation: arUI, map: arMap },
    },
    ns: ['translation', 'map'],
    defaultNS: 'translation',
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'vi', 'ar'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;
