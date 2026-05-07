import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth';
import { useTranslation } from 'react-i18next';
import type { AdminFacility, EditStatusField } from '../../types/facility';
import rawOutputs from '../../../amplify_outputs.json';
import styles from './AdminPanel.module.css';

const FEATURE_LAYER_URL =
  'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0';

interface AmplifyOutputsShape {
  custom?: { API?: { facilityStatusApiUrl?: string } };
}

const resolvedApiBase =
  (rawOutputs as AmplifyOutputsShape).custom?.API?.facilityStatusApiUrl ?? '';

interface PendingToggle {
  facilityId: number;
  facilityName: string;
  field: EditStatusField;
  newValue: boolean;
  clearField?: EditStatusField;
}

interface ArcGISQueryResponse {
  features?: Array<{ attributes: AdminFacility }>;
  error?: { code: number; message: string };
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ts));
}

interface AdminPanelProps {
  signOut: () => void;
  userEmail: string;
  isSuperAdmin?: boolean;
}

export default function AdminPanel({ signOut, userEmail, isSuperAdmin }: AdminPanelProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const wasUnauthorized = (location.state as { unauthorized?: boolean })?.unauthorized;
  const [email, setEmail] = useState(userEmail);
  const [facilities, setFacilities] = useState<AdminFacility[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  const [updatingKeys, setUpdatingKeys] = useState<Set<string>>(new Set());
  const [keepOpenIds, setKeepOpenIds] = useState<Set<number>>(new Set());
  const [keepOpenPendingIds, setKeepOpenPendingIds] = useState<Set<number>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const announcerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadFacilities() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const attrs = await fetchUserAttributes();
        const resolvedEmail = attrs.email ?? userEmail;
        if (!cancelled) setEmail(resolvedEmail);

        const facilityIdsStr = (attrs['custom:facility_ids'] as string | undefined) ?? '';
        const ids = facilityIdsStr
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);

        if (ids.length === 0) {
          if (!cancelled) setFacilities([]);
          return;
        }

        const params = new URLSearchParams({
          where: `ObjectID IN (${ids.join(',')})`,
          outFields:
            'ObjectID,Name,Address,Warming_Active,Cooling_Active,EditDate',
          returnGeometry: 'false',
          f: 'json',
        });

        const [facilitiesRes, session] = await Promise.all([
          fetch(`${FEATURE_LAYER_URL}/query?${params.toString()}`),
          fetchAuthSession(),
        ]);

        const data = (await facilitiesRes.json()) as ArcGISQueryResponse;
        if (data.error) throw new Error(data.error.message);

        const loaded = (data.features ?? []).map((f) => f.attributes);
        if (!cancelled) setFacilities(loaded);

        // Load keep-open overrides
        const idToken = session.tokens?.idToken?.toString() ?? '';
        const keepOpenRes = await fetch(`${resolvedApiBase}facilities/keep-open`, {
          headers: { Authorization: idToken },
        });
        if (keepOpenRes.ok) {
          const keepOpenData = (await keepOpenRes.json()) as { keepOpenIds: number[] };
          if (!cancelled) setKeepOpenIds(new Set(keepOpenData.keepOpenIds));
        }
      } catch (err) {
        if (!cancelled) setLoadError(t('common.error'));
        console.error('AdminPanel load error:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadFacilities();
    return () => {
      cancelled = true;
    };
  }, [userEmail, t]);

  // Open confirm dialog when a toggle is initiated
  useEffect(() => {
    if (pendingToggle) {
      requestAnimationFrame(() => {
        dialogRef.current?.showModal();
        cancelBtnRef.current?.focus();
      });
    }
  }, [pendingToggle]);

  const initiateToggle = useCallback(
    (facility: AdminFacility, field: EditStatusField) => {
      const newValue = facility[field] !== 'Yes';
      let clearField: EditStatusField | undefined;

      if (newValue) {
        const otherField: EditStatusField =
          field === 'Warming_Active' ? 'Cooling_Active' : 'Warming_Active';
        if (facility[otherField] === 'Yes') {
          clearField = otherField;
        }
      }

      setPendingToggle({
        facilityId: facility.ObjectID,
        facilityName: facility.Name,
        field,
        newValue,
        clearField,
      });
    },
    [],
  );

  const handleCancel = useCallback(() => {
    dialogRef.current?.close();
    setPendingToggle(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingToggle) return;
    const { facilityId, field, newValue, clearField } = pendingToggle;
    const key = `${facilityId}-${field}`;
    const clearKey = clearField ? `${facilityId}-${clearField}` : null;

    dialogRef.current?.close();
    setPendingToggle(null);

    setUpdatingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      if (clearKey) next.add(clearKey);
      return next;
    });

    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString() ?? '';

      const res = await fetch(`${resolvedApiBase}facilities/status`, {
        method: 'POST',
        headers: { Authorization: idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureId: facilityId, field, value: newValue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      if (clearField) {
        const clearRes = await fetch(`${resolvedApiBase}facilities/status`, {
          method: 'POST',
          headers: { Authorization: idToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ featureId: facilityId, field: clearField, value: false }),
        });
        if (!clearRes.ok) throw new Error(`HTTP ${clearRes.status}`);
      }

      // Clear keep-open override on any Warming/Cooling toggle
      if (keepOpenIds.has(facilityId)) {
        void fetch(`${resolvedApiBase}facilities/keep-open`, {
          method: 'PATCH',
          headers: { Authorization: idToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ facilityId, keepOpen: false }),
        }).then(() => {
          setKeepOpenIds((prev) => {
            const next = new Set(prev);
            next.delete(facilityId);
            return next;
          });
        });
      }

      setFacilities((prev) =>
        prev.map((f) => {
          if (f.ObjectID !== facilityId) return f;
          const updated = { ...f, [field]: newValue ? 'Yes' : 'No', EditDate: Date.now() };
          if (clearField) return { ...updated, [clearField]: 'No' };
          return updated;
        }),
      );

      setAnnouncement(t('admin.panel.updateSuccess'));
    } catch (err) {
      console.error('Update error:', err);
      setAnnouncement(t('admin.panel.updateError'));
    } finally {
      setUpdatingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        if (clearKey) next.delete(clearKey);
        return next;
      });
    }
  }, [pendingToggle, keepOpenIds, t]);

  const handleKeepOpenToggle = useCallback(
    async (facility: AdminFacility) => {
      const facilityId = facility.ObjectID;
      const nextValue = !keepOpenIds.has(facilityId);

      setKeepOpenPendingIds((prev) => new Set(prev).add(facilityId));

      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString() ?? '';

        const res = await fetch(`${resolvedApiBase}facilities/keep-open`, {
          method: 'PATCH',
          headers: { Authorization: idToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ facilityId, keepOpen: nextValue }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        setKeepOpenIds((prev) => {
          const next = new Set(prev);
          if (nextValue) next.add(facilityId);
          else next.delete(facilityId);
          return next;
        });
      } catch (err) {
        console.error('keepOpen toggle error:', err);
        setAnnouncement(t('admin.panel.updateError'));
      } finally {
        setKeepOpenPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(facilityId);
          return next;
        });
      }
    },
    [keepOpenIds, t],
  );

  const conflictType = pendingToggle?.clearField === 'Warming_Active'
    ? t('admin.panel.warming')
    : t('admin.panel.cooling');
  const newType = pendingToggle?.field === 'Warming_Active'
    ? t('admin.panel.warming')
    : t('admin.panel.cooling');

  const confirmMessage = pendingToggle
    ? t('admin.panel.confirmMessage', {
        name: pendingToggle.facilityName,
        status: pendingToggle.newValue
          ? t('admin.panel.open')
          : t('admin.panel.closed'),
        type: pendingToggle.field === 'Warming_Active'
          ? t('admin.panel.warming')
          : t('admin.panel.cooling'),
      })
    : '';

  const conflictWarning =
    pendingToggle?.clearField && pendingToggle.newValue
      ? t('admin.panel.conflictWarning', {
          newType,
          clearType: conflictType,
        })
      : '';

  return (
    <div className={styles.panel}>
      {/* ARIA live region for status announcements */}
      <div
        ref={announcerRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      >
        {announcement}
      </div>

      {wasUnauthorized && (
        <div role="alert" className={styles.unauthorizedMsg}>
          {t('admin.panel.unauthorizedAccess')}
        </div>
      )}

      <div className={styles.header}>
        <div>
          <h1 className={styles.welcome}>{t('admin.panel.welcome', { email })}</h1>
          {isSuperAdmin && (
            <nav aria-label={t('admin.panel.adminNavLabel')}>
              <Link to="/admin/users" className={styles.adminNavLink}>
                {t('admin.users.navLink')}
              </Link>
            </nav>
          )}
        </div>
        <button onClick={signOut} className={styles.signOutBtn} type="button">
          {t('admin.panel.signOut')}
        </button>
      </div>

      <section aria-labelledby="facilities-heading">
        <h2 id="facilities-heading" className={styles.sectionHeading}>
          {t('admin.panel.facilities')}
        </h2>

        {isLoading && (
          <div className={styles.loadingState} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            {t('admin.panel.loading')}
          </div>
        )}

        {loadError && !isLoading && (
          <p className={styles.errorMsg} role="alert">
            {loadError}
          </p>
        )}

        {!isLoading && !loadError && facilities.length === 0 && (
          <p className={styles.emptyMsg}>{t('admin.panel.noFacilities')}</p>
        )}

        {!isLoading && facilities.length > 0 && (
          <ul className={styles.facilityList} aria-label={t('admin.panel.facilities')}>
            {facilities.map((facility) => {
              const warmingKey = `${facility.ObjectID}-Warming_Active`;
              const coolingKey = `${facility.ObjectID}-Cooling_Active`;
              const isWarmingActive = facility.Warming_Active === 'Yes';
              const isCoolingActive = facility.Cooling_Active === 'Yes';
              const isKeptOpen = keepOpenIds.has(facility.ObjectID);
              const isKeepOpenPending = keepOpenPendingIds.has(facility.ObjectID);
              const editTs = facility.EditDate;

              return (
                <li
                  key={facility.ObjectID}
                  className={`${styles.facilityCard} ${isKeptOpen ? styles.facilityCardKeptOpen : ''}`}
                >
                  <div className={styles.facilityInfo}>
                    <h3 className={styles.facilityName}>{facility.Name}</h3>
                    <p className={styles.facilityAddress}>{facility.Address}</p>
                    {editTs && (
                      <p className={styles.lastUpdated}>
                        {t('admin.panel.lastUpdated')}: {formatDate(editTs)}
                      </p>
                    )}
                    {isKeptOpen && (
                      <p className={styles.keepOpenBadge}>
                        {t('admin.panel.keepOpenActive')}
                      </p>
                    )}
                  </div>

                  <div className={styles.cardControls}>
                    <div className={styles.toggleRow}>
                      <ToggleSwitch
                        label={t('admin.panel.warmingActive')}
                        facilityName={facility.Name}
                        isActive={isWarmingActive}
                        isPending={updatingKeys.has(warmingKey)}
                        onToggle={() => initiateToggle(facility, 'Warming_Active')}
                      />
                      <ToggleSwitch
                        label={t('admin.panel.coolingActive')}
                        facilityName={facility.Name}
                        isActive={isCoolingActive}
                        isPending={updatingKeys.has(coolingKey)}
                        onToggle={() => initiateToggle(facility, 'Cooling_Active')}
                      />
                    </div>

                    <div className={styles.keepOpenRow}>
                      <label className={styles.keepOpenLabel}>
                        <input
                          type="checkbox"
                          className={styles.keepOpenCheckbox}
                          checked={isKeptOpen}
                          disabled={isKeepOpenPending}
                          onChange={() => void handleKeepOpenToggle(facility)}
                          aria-label={t('admin.panel.keepOpenAria', { name: facility.Name })}
                        />
                        {t('admin.panel.keepOpen')}
                      </label>
                      <button
                        type="button"
                        className={styles.tooltipBtn}
                        aria-label={t('admin.panel.keepOpenTooltip')}
                        title={t('admin.panel.keepOpenTooltip')}
                      >
                        <span aria-hidden="true">ⓘ</span>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Confirmation dialog — native <dialog> for built-in focus trapping */}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2 id="dialog-title" className={styles.dialogTitle}>
          {t('admin.panel.confirmTitle')}
        </h2>
        <p className={styles.dialogMessage}>{confirmMessage}</p>
        {conflictWarning && (
          <p className={styles.conflictWarning}>{conflictWarning}</p>
        )}
        <div className={styles.dialogActions}>
          <button
            type="button"
            ref={cancelBtnRef}
            onClick={handleCancel}
            className={styles.btnSecondary}
          >
            {t('admin.panel.confirmNo')}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            className={styles.btnPrimary}
          >
            {t('admin.panel.confirmYes')}
          </button>
        </div>
      </dialog>
    </div>
  );
}

interface ToggleSwitchProps {
  label: string;
  facilityName: string;
  isActive: boolean;
  isPending: boolean;
  onToggle: () => void;
}

function ToggleSwitch({
  label,
  facilityName,
  isActive,
  isPending,
  onToggle,
}: ToggleSwitchProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.toggle}>
      <span className={styles.toggleLabel}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={isActive}
        aria-label={`${label} — ${facilityName}`}
        disabled={isPending}
        onClick={onToggle}
        className={`${styles.toggleBtn} ${isActive ? styles.toggleBtnOn : ''}`}
      >
        {isPending ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <span className={styles.toggleKnob} aria-hidden="true" />
        )}
        <span className={styles.srOnly}>
          {isActive ? t('status.open') : t('status.closed')}
        </span>
      </button>
    </div>
  );
}
