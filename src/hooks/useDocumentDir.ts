import { useEffect } from 'react';

const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

export function useDocumentDir(language: string): void {
  useEffect(() => {
    const base = language.split('-')[0];
    const dir = RTL_LANGS.has(base) ? 'rtl' : 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = language;
  }, [language]);
}
