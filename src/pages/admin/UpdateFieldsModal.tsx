import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFieldSchema } from '../../utils/fieldSchemaCache';
import type { FieldDef } from '../../utils/fieldSchemaCache';
import { getFieldConfig, setFieldConfigCache } from '../../utils/fieldConfig';
import styles from './UpdateFieldsModal.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (fields: string[]) => void;
  apiBase: string;
  idToken: string;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function UpdateFieldsModal({
  isOpen,
  onClose,
  onSaved,
  apiBase,
  idToken,
  triggerRef,
}: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [allFields, setAllFields] = useState<FieldDef[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const aliasFor = useCallback(
    (name: string) => allFields.find((f) => f.name === name)?.alias ?? name,
    [allFields],
  );

  // Load fresh schema + saved config when the modal opens
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!isOpen) {
      dialog.close();
      return;
    }

    dialog.showModal();
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    setAnnouncement('');

    void (async () => {
      try {
        const [schema, saved] = await Promise.all([
          getFieldSchema(true),
          getFieldConfig(apiBase, idToken),
        ]);
        if (cancelled) return;
        setAllFields(schema);
        const names = new Set(schema.map((f) => f.name));
        // Saved order wins; if nothing saved yet, default to "all enabled" in
        // schema order to mirror the current effective edit-view behavior.
        const initial = saved.length
          ? saved.filter((n) => names.has(n))
          : schema.map((f) => f.name);
        setEnabled(initial);
      } catch (err) {
        if (!cancelled) setLoadError(t('admin.fieldConfig.loadError'));
        console.error('UpdateFieldsModal load error:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, apiBase, idToken, t]);

  // Restore focus to the trigger on close
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => triggerRef.current?.focus();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [triggerRef]);

  const reorder = useCallback((from: number, to: number, name: string) => {
    setEnabled((prev) => move(prev, from, to));
    if (to >= 0) {
      requestAnimationFrame(() => document.getElementById(`fieldorder-${name}`)?.focus());
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number, name: string) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        reorder(index, index - 1, name);
        setAnnouncement(t('admin.fieldConfig.movedUp', { field: aliasFor(name) }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        reorder(index, index + 1, name);
        setAnnouncement(t('admin.fieldConfig.movedDown', { field: aliasFor(name) }));
      }
    },
    [reorder, aliasFor, t],
  );

  const handleDrop = useCallback(
    (index: number) => {
      if (dragIndex === null || dragIndex === index) return;
      setEnabled((prev) => move(prev, dragIndex, index));
      setDragIndex(null);
    },
    [dragIndex],
  );

  const toggleField = useCallback(
    (name: string, checked: boolean) => {
      setEnabled((prev) => {
        if (checked) return prev.includes(name) ? prev : [...prev, name];
        return prev.filter((n) => n !== name);
      });
      setAnnouncement(
        checked
          ? t('admin.fieldConfig.enabled', { field: aliasFor(name) })
          : t('admin.fieldConfig.disabled', { field: aliasFor(name) }),
      );
    },
    [aliasFor, t],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}admin/field-config`, {
        method: 'PATCH',
        headers: { Authorization: idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFieldConfigCache(enabled);
      onSaved(enabled);
      onClose();
    } catch (err) {
      console.error('saveFieldConfig error:', err);
      setSaveError(t('admin.fieldConfig.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [apiBase, idToken, enabled, onSaved, onClose, t]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-modal="true"
      aria-labelledby="update-fields-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div aria-live="polite" aria-atomic="true" className={styles.srOnly}>
        {announcement}
      </div>

      <div className={styles.header}>
        <h2 id="update-fields-title" className={styles.title}>
          {t('admin.fieldConfig.title')}
        </h2>
        <button
          type="button"
          className={styles.closeBtn}
          aria-label={t('admin.fieldConfig.cancel')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {isLoading && (
        <div className={styles.state} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          {t('admin.fieldConfig.loading')}
        </div>
      )}

      {loadError && !isLoading && (
        <p className={styles.errorMsg} role="alert">{loadError}</p>
      )}

      {!isLoading && !loadError && (
        <div className={styles.body}>
          <section aria-labelledby="field-order-heading" className={styles.view}>
            <h3 id="field-order-heading" className={styles.viewHeading}>
              {t('admin.fieldConfig.orderHeading')}
            </h3>
            <p className={styles.viewHint}>{t('admin.fieldConfig.orderHint')}</p>
            {enabled.length === 0 ? (
              <p className={styles.empty}>{t('admin.fieldConfig.orderEmpty')}</p>
            ) : (
              <ul className={styles.orderList}>
                {enabled.map((name, index) => (
                  <li key={name} className={styles.orderItem}>
                    <button
                      id={`fieldorder-${name}`}
                      type="button"
                      className={`${styles.chip} ${dragIndex === index ? styles.chipDragging : ''}`}
                      draggable
                      aria-roledescription={t('admin.fieldConfig.reorderRole')}
                      aria-label={t('admin.fieldConfig.chipAria', {
                        field: aliasFor(name),
                        position: index + 1,
                        total: enabled.length,
                      })}
                      onDragStart={() => setDragIndex(index)}
                      onDragEnd={() => setDragIndex(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(index)}
                      onKeyDown={(e) => handleKeyDown(e, index, name)}
                    >
                      <span className={styles.dragHandle} aria-hidden="true">⠿</span>
                      {aliasFor(name)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="field-enable-heading" className={styles.view}>
            <h3 id="field-enable-heading" className={styles.viewHeading}>
              {t('admin.fieldConfig.enableHeading')}
            </h3>
            <p className={styles.viewHint}>{t('admin.fieldConfig.enableHint')}</p>
            <ul className={styles.fieldList}>
              {allFields.map((f) => (
                <li key={f.name} className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={enabled.includes(f.name)}
                      onChange={(e) => toggleField(f.name, e.target.checked)}
                    />
                    <span>{f.alias}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {saveError && (
        <p className={styles.errorMsg} role="alert" aria-live="assertive">{saveError}</p>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.btnSecondary} onClick={onClose}>
          {t('admin.fieldConfig.cancel')}
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={isSaving || isLoading || !!loadError}
          onClick={() => void handleSave()}
        >
          {isSaving ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              {t('admin.fieldConfig.saving')}
            </>
          ) : (
            t('admin.fieldConfig.save')
          )}
        </button>
      </div>
    </dialog>
  );
}
