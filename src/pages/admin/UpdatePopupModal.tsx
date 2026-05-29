import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFieldSchema } from '../../utils/fieldSchemaCache';
import type { FieldDef } from '../../utils/fieldSchemaCache';
import {
  DEFAULT_POPUP_LAYOUT,
  getPublicPopupConfig,
  setPopupConfigCache,
  type PopupSection,
} from '../../utils/popupConfig';
import styles from './UpdatePopupModal.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (sections: PopupSection[]) => void;
  apiBase: string;
  idToken: string;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

// Status fields are surfaced as the badge row, not as info rows.
const DISPLAY_EXCLUDE = new Set(['Warming_Active', 'Cooling_Active']);

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function uuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function UpdatePopupModal({
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
  const [sections, setSections] = useState<PopupSection[]>([]);
  const [adderSectionId, setAdderSectionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [sectionDrag, setSectionDrag] = useState<number | null>(null);
  const [fieldDrag, setFieldDrag] = useState<{ sectionId: string; index: number } | null>(null);

  const aliasFor = useCallback(
    (name: string) => allFields.find((f) => f.name === name)?.alias ?? name,
    [allFields],
  );

  const assigned = useMemo(() => new Set(sections.flatMap((s) => s.fields)), [sections]);
  const unassigned = useMemo(
    () => allFields.filter((f) => !assigned.has(f.name)),
    [allFields, assigned],
  );

  // Load fresh schema + saved layout when the modal opens
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
    setAdderSectionId(null);

    void (async () => {
      try {
        const [schema, saved] = await Promise.all([
          getFieldSchema(true),
          getPublicPopupConfig(),
        ]);
        if (cancelled) return;
        // Reflect whatever is live in the feature layer (getFieldSchema(true)
        // bypasses the cache), minus the status fields shown as the badge row.
        const available = schema.filter((f) => !DISPLAY_EXCLUDE.has(f.name));
        const names = new Set(available.map((f) => f.name));
        setAllFields(available);

        if (saved.length) {
          // Drop any field names no longer present in the layer.
          setSections(
            saved.map((s) => ({
              id: s.id || uuid(),
              title: s.title,
              fields: s.fields.filter((n) => names.has(n)),
            })),
          );
        } else {
          // Pre-fill the current default layout; resolve i18n titles into literal
          // strings (per the "customize → literal title" decision).
          setSections(
            DEFAULT_POPUP_LAYOUT.map((s) => ({
              id: uuid(),
              title: t(s.titleKey),
              fields: s.fields.filter((n) => names.has(n)),
            })),
          );
        }
      } catch (err) {
        if (!cancelled) setLoadError(t('admin.popupConfig.loadError'));
        console.error('UpdatePopupModal load error:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, t]);

  // Restore focus to the trigger on close
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => triggerRef.current?.focus();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [triggerRef]);

  // ── Section operations ──────────────────────────────────────────────────────
  const addSection = useCallback(() => {
    setSections((prev) => [...prev, { id: uuid(), title: '', fields: [] }]);
    setAnnouncement(t('admin.popupConfig.sectionAdded'));
  }, [t]);

  const removeSection = useCallback(
    (id: string) => {
      setSections((prev) => prev.filter((s) => s.id !== id));
      setAnnouncement(t('admin.popupConfig.sectionRemoved'));
    },
    [t],
  );

  const setTitle = useCallback((id: string, title: string) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const reorderSection = useCallback(
    (from: number, to: number, id: string) => {
      setSections((prev) => move(prev, from, to));
      if (to >= 0 && to < sections.length) {
        requestAnimationFrame(() => document.getElementById(`sechandle-${id}`)?.focus());
      }
    },
    [sections.length],
  );

  // ── Field operations (within a section) ─────────────────────────────────────
  const addField = useCallback(
    (sectionId: string, name: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId && !s.fields.includes(name)
            ? { ...s, fields: [...s.fields, name] }
            : s,
        ),
      );
      setAdderSectionId(null);
      setAnnouncement(t('admin.popupConfig.fieldAdded', { field: aliasFor(name) }));
    },
    [aliasFor, t],
  );

  const removeField = useCallback(
    (sectionId: string, name: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId ? { ...s, fields: s.fields.filter((n) => n !== name) } : s,
        ),
      );
      setAnnouncement(t('admin.popupConfig.fieldRemoved', { field: aliasFor(name) }));
    },
    [aliasFor, t],
  );

  const reorderField = useCallback(
    (sectionId: string, from: number, to: number, name: string) => {
      setSections((prev) =>
        prev.map((s) => {
          if (s.id !== sectionId) return s;
          if (to < 0 || to >= s.fields.length) return s;
          return { ...s, fields: move(s.fields, from, to) };
        }),
      );
      requestAnimationFrame(() => document.getElementById(`fld-${sectionId}-${name}`)?.focus());
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}admin/popup-config`, {
        method: 'PATCH',
        headers: { Authorization: idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPopupConfigCache(sections);
      onSaved(sections);
      onClose();
    } catch (err) {
      console.error('savePopupConfig error:', err);
      setSaveError(t('admin.popupConfig.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [apiBase, idToken, sections, onSaved, onClose, t]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-modal="true"
      aria-labelledby="update-popup-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div aria-live="polite" aria-atomic="true" className={styles.srOnly}>
        {announcement}
      </div>

      <div className={styles.header}>
        <h2 id="update-popup-title" className={styles.title}>
          {t('admin.popupConfig.title')}
        </h2>
        <button
          type="button"
          className={styles.closeBtn}
          aria-label={t('admin.popupConfig.cancel')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <p className={styles.hint}>{t('admin.popupConfig.hint')}</p>

      {isLoading && (
        <div className={styles.state} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          {t('admin.popupConfig.loading')}
        </div>
      )}

      {loadError && !isLoading && <p className={styles.errorMsg} role="alert">{loadError}</p>}

      {!isLoading && !loadError && (
        <>
          <div className={styles.toolbar}>
            <button type="button" className={styles.addSectionBtn} onClick={addSection}>
              + {t('admin.popupConfig.addSection')}
            </button>
          </div>

          <div className={styles.body}>
            {sections.length === 0 ? (
              <p className={styles.empty}>{t('admin.popupConfig.noSections')}</p>
            ) : (
              <ul className={styles.sectionList}>
                {sections.map((section, sIndex) => (
                  <li
                    key={section.id}
                    className={`${styles.section} ${sectionDrag === sIndex ? styles.sectionDragging : ''}`}
                    onDragOver={(e) => {
                      if (sectionDrag !== null) e.preventDefault();
                    }}
                    onDrop={() => {
                      if (sectionDrag !== null && sectionDrag !== sIndex) {
                        setSections((prev) => move(prev, sectionDrag, sIndex));
                      }
                      setSectionDrag(null);
                    }}
                  >
                    <div className={styles.sectionHeader}>
                      <button
                        id={`sechandle-${section.id}`}
                        type="button"
                        className={styles.sectionHandle}
                        draggable
                        aria-label={t('admin.popupConfig.sectionHandleAria', {
                          title: section.title || t('admin.popupConfig.untitled'),
                          position: sIndex + 1,
                          total: sections.length,
                        })}
                        onDragStart={() => setSectionDrag(sIndex)}
                        onDragEnd={() => setSectionDrag(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            reorderSection(sIndex, sIndex - 1, section.id);
                            setAnnouncement(t('admin.popupConfig.sectionMovedUp'));
                          } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            reorderSection(sIndex, sIndex + 1, section.id);
                            setAnnouncement(t('admin.popupConfig.sectionMovedDown'));
                          }
                        }}
                      >
                        ⠿
                      </button>
                      <input
                        type="text"
                        className={styles.titleInput}
                        value={section.title}
                        placeholder={t('admin.popupConfig.sectionTitlePlaceholder')}
                        aria-label={t('admin.popupConfig.sectionTitleAria', { position: sIndex + 1 })}
                        onChange={(e) => setTitle(section.id, e.target.value)}
                      />
                      <button
                        type="button"
                        className={styles.removeSectionBtn}
                        aria-label={t('admin.popupConfig.removeSectionAria', {
                          title: section.title || t('admin.popupConfig.untitled'),
                        })}
                        onClick={() => removeSection(section.id)}
                      >
                        🗑
                      </button>
                    </div>

                    {section.fields.length > 0 && (
                      <ul className={styles.fieldChips}>
                        {section.fields.map((name, fIndex) => (
                          <li key={name} className={styles.fieldChipItem}>
                            <span
                              id={`fld-${section.id}-${name}`}
                              className={`${styles.fieldChip} ${
                                fieldDrag?.sectionId === section.id && fieldDrag.index === fIndex
                                  ? styles.fieldChipDragging
                                  : ''
                              }`}
                              tabIndex={0}
                              role="button"
                              draggable
                              aria-label={t('admin.popupConfig.fieldChipAria', {
                                field: aliasFor(name),
                                position: fIndex + 1,
                                total: section.fields.length,
                              })}
                              onDragStart={() => setFieldDrag({ sectionId: section.id, index: fIndex })}
                              onDragEnd={() => setFieldDrag(null)}
                              onDragOver={(e) => {
                                if (fieldDrag?.sectionId === section.id) e.preventDefault();
                              }}
                              onDrop={() => {
                                if (
                                  fieldDrag &&
                                  fieldDrag.sectionId === section.id &&
                                  fieldDrag.index !== fIndex
                                ) {
                                  reorderField(section.id, fieldDrag.index, fIndex, name);
                                }
                                setFieldDrag(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  reorderField(section.id, fIndex, fIndex - 1, name);
                                } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  reorderField(section.id, fIndex, fIndex + 1, name);
                                }
                              }}
                            >
                              <span className={styles.dragHandle} aria-hidden="true">⠿</span>
                              {aliasFor(name)}
                              <button
                                type="button"
                                className={styles.removeFieldBtn}
                                aria-label={t('admin.popupConfig.removeField', { field: aliasFor(name) })}
                                onClick={() => removeField(section.id, name)}
                              >
                                −
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className={styles.adder}>
                      <button
                        type="button"
                        className={styles.addFieldBtn}
                        aria-expanded={adderSectionId === section.id}
                        aria-label={t('admin.popupConfig.addFieldAria', {
                          title: section.title || t('admin.popupConfig.untitled'),
                        })}
                        onClick={() =>
                          setAdderSectionId(adderSectionId === section.id ? null : section.id)
                        }
                      >
                        +
                      </button>
                      {adderSectionId === section.id && (
                        <div className={styles.adderList}>
                          {unassigned.length === 0 ? (
                            <p className={styles.adderEmpty}>{t('admin.popupConfig.allAssigned')}</p>
                          ) : (
                            unassigned.map((f) => (
                              <button
                                key={f.name}
                                type="button"
                                className={styles.adderOption}
                                onClick={() => addField(section.id, f.name)}
                              >
                                {f.alias}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {saveError && (
        <p className={styles.errorMsg} role="alert" aria-live="assertive">{saveError}</p>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.btnSecondary} onClick={onClose}>
          {t('admin.popupConfig.cancel')}
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
              {t('admin.popupConfig.saving')}
            </>
          ) : (
            t('admin.popupConfig.save')
          )}
        </button>
      </div>
    </dialog>
  );
}
