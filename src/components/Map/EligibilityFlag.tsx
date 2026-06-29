import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTranslateContent } from '../../hooks/useTranslateContent';
import styles from './FacilityPopup.module.css';

/**
 * Header flag shown when a facility has eligibility requirements. Clicking it
 * opens a small non-modal popover with the actual requirement text so people
 * who aren't eligible don't show up by mistake.
 */
export default function EligibilityFlag({ eligibility }: { eligibility: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const titleId = useId();
  const { translatedText } = useTranslateContent(eligibility, i18n.language);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase + stopPropagation so the dialog's own Escape handler
        // doesn't also fire and close the entire pop-up.
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const handlePointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointer, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointer, true);
    };
  }, [open]);

  // Move focus into the popover when it opens so AT reads the requirements.
  useEffect(() => {
    if (open) popoverRef.current?.focus();
  }, [open]);

  return (
    <div className={styles.eligibilityFlagWrap}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.eligibilityFlag}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={t('popup.eligibilityFlagAria')}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⚠</span>
        <span>{t('popup.eligibilityFlag')}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={styles.eligibilityPopover}
        >
          <p id={titleId} className={styles.eligibilityPopoverTitle}>
            {t('popup.eligibilityPopoverTitle')}
          </p>
          <p className={styles.eligibilityPopoverBody}>{translatedText || eligibility}</p>
          <button
            type="button"
            className={styles.eligibilityPopoverClose}
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
          >
            {t('popup.close')}
          </button>
        </div>
      )}
    </div>
  );
}
