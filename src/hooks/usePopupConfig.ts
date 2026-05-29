import { useEffect, useState } from 'react';
import {
  getCachedPopupConfig,
  getPublicPopupConfig,
  subscribePopupConfig,
  type PopupSection,
} from '../utils/popupConfig';

// Returns the saved pop-up layout (or [] when none/loading). Fetches once on
// first use, serves the module cache thereafter, and re-renders if an admin
// saves a new layout in the same tab.
export function usePopupConfig(): PopupSection[] {
  const [sections, setSections] = useState<PopupSection[]>(() => getCachedPopupConfig() ?? []);

  useEffect(() => {
    let cancelled = false;
    if (getCachedPopupConfig() == null) {
      void getPublicPopupConfig().then((s) => {
        if (!cancelled) setSections(s);
      });
    }
    const unsub = subscribePopupConfig(setSections);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return sections;
}
