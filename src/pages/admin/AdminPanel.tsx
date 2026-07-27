import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth';
import { useTranslation } from 'react-i18next';
import { getPublicArcGISToken } from '../../utils/arcgisToken';
import type { AdminFacility, EditStatusField } from '../../types/facility';
import { getFieldSchema } from '../../utils/fieldSchemaCache';
import type { FieldDef } from '../../utils/fieldSchemaCache';
import { getFieldConfig, applyFieldConfig } from '../../utils/fieldConfig';
import rawOutputs from '../../../amplify_outputs.json';
import AddFacilityModal from './AddFacilityModal';
import UpdateFieldsModal from './UpdateFieldsModal';
import UpdatePopupModal from './UpdatePopupModal';
import HoursEditor from '../../components/admin/HoursEditor';
import AddressAutocomplete from '../../components/admin/AddressAutocomplete';
import { geocodeAddress, geocodeByMagicKey, type GeocodeResult, type AddressSuggestion } from '../../utils/geocode';
import styles from './AdminPanel.module.css';

const FEATURE_LAYER_URL =
  'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0';

function isAddressField(f: FieldDef): boolean {
  return /address/i.test(f.name) || /address/i.test(f.alias);
}

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

type RawAttrs = Record<string, string | number | null>;

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
  isAdmin?: boolean;
  isApproved?: boolean;
  isPending?: boolean;
}

const REQUEST_ACCESS_KEY = 'wcc.requestAccessSent';

export default function AdminPanel({
  signOut,
  userEmail,
  isSuperAdmin,
  isAdmin,
  isApproved,
  isPending,
}: AdminPanelProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const wasUnauthorized = (location.state as { unauthorized?: boolean })?.unauthorized;

  const [email, setEmail] = useState(userEmail);
  const [idToken, setIdToken] = useState('');
  const [facilities, setFacilities] = useState<AdminFacility[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  const [updatingKeys, setUpdatingKeys] = useState<Set<string>>(new Set());
  const [keepOpenIds, setKeepOpenIds] = useState<Set<number>>(new Set());
  const [keepOpenPendingIds, setKeepOpenPendingIds] = useState<Set<number>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [fieldsModalOpen, setFieldsModalOpen] = useState(false);
  const [popupModalOpen, setPopupModalOpen] = useState(false);
  const [fieldConfig, setFieldConfig] = useState<string[] | null>(null);
  const [requestAccessSent, setRequestAccessSent] = useState(() => {
    try {
      return sessionStorage.getItem(REQUEST_ACCESS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [requestAccessPending, setRequestAccessPending] = useState(false);

  const canAddFacility = Boolean(isSuperAdmin || isAdmin || isApproved);
  const showRequestAccess = !canAddFacility && Boolean(isPending);

  const handleRequestAccess = useCallback(async () => {
    setRequestAccessPending(true);
    try {
      const session = await fetchAuthSession();
      const tok = session.tokens?.idToken?.toString() ?? '';
      const res = await fetch(`${resolvedApiBase}admin/request-access`, {
        method: 'POST',
        headers: { Authorization: tok, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try {
        sessionStorage.setItem(REQUEST_ACCESS_KEY, '1');
      } catch {
        /* sessionStorage unavailable; soft-degrade */
      }
      setRequestAccessSent(true);
      setAnnouncement(t('admin.requestAccess.sent'));
    } catch (err) {
      console.error('requestAccess error:', err);
      setAnnouncement(t('admin.requestAccess.error'));
    } finally {
      setRequestAccessPending(false);
    }
  }, [t]);

  // Notifications-in-place state
  const [notifExpandedId, setNotifExpandedId] = useState<number | null>(null);
  const [notifEmails, setNotifEmails] = useState('');
  const [isNotifLoading, setIsNotifLoading] = useState(false);
  const [isNotifSaving, setIsNotifSaving] = useState(false);
  const [notifLoadError, setNotifLoadError] = useState<string | null>(null);
  const [notifSaveError, setNotifSaveError] = useState<string | null>(null);

  // Tooltip open state
  const [openTooltipId, setOpenTooltipId] = useState<number | null>(null);

  // Edit-in-place state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedRawAttrs, setExpandedRawAttrs] = useState<RawAttrs | null>(null);
  const [expandedFields, setExpandedFields] = useState<FieldDef[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [isExpandLoading, setIsExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [isSavingAttrs, setIsSavingAttrs] = useState(false);
  const [saveAttrsError, setSaveAttrsError] = useState<string | null>(null);

  // Address-changed → geocode confirmation before moving the map pin/geometry
  const [pendingAddrSave, setPendingAddrSave] = useState<{
    facilityId: number;
    attributes: RawAttrs;
    geo: GeocodeResult | null;
  } | null>(null);
  // Precise coords for an address picked from the autocomplete dropdown; used at
  // save so a picked suggestion skips the ambiguous free-text geocode.
  const [pickedAddr, setPickedAddr] = useState<(GeocodeResult & { text: string }) | null>(null);

  const [pendingDelete, setPendingDelete] = useState<{ facilityId: number; facilityName: string } | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<number | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteCancelBtnRef = useRef<HTMLButtonElement>(null);
  const addrDialogRef = useRef<HTMLDialogElement>(null);
  const addrCancelBtnRef = useRef<HTMLButtonElement>(null);
  const announcerRef = useRef<HTMLDivElement>(null);
  const addNewBtnRef = useRef<HTMLButtonElement>(null);
  const updateFieldsBtnRef = useRef<HTMLButtonElement>(null);
  const updatePopupBtnRef = useRef<HTMLButtonElement>(null);
  const firstEditFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // Authorized API call with stale-token self-heal: the cached id token's
  // custom:facility_ids claim can lag a recent grant → 403. On a 403, force-refresh
  // the token once and retry so the claim catches up.
  const authedFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const send = async (forceRefresh: boolean) => {
      const session = await fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined);
      const tok = session.tokens?.idToken?.toString() ?? '';
      return fetch(`${resolvedApiBase}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: tok },
      });
    };
    let res = await send(false);
    if (res.status === 403) res = await send(true);
    return res;
  }, []);

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

        const [facilitiesRes, session] = await Promise.all([
          ids.length > 0
            ? getPublicArcGISToken().then((token) =>
                fetch(`${FEATURE_LAYER_URL}/query?${new URLSearchParams({
                  where: `ObjectID IN (${ids.join(',')})`,
                  outFields: 'ObjectID,Name,Address,Warming_Active,Cooling_Active,EditDate',
                  returnGeometry: 'false',
                  f: 'json',
                  token,
                })}`)
              )
            : Promise.resolve(null),
          fetchAuthSession(),
        ]);

        const tok = session.tokens?.idToken?.toString() ?? '';
        if (!cancelled) setIdToken(tok);

        if (ids.length === 0) {
          if (!cancelled) setFacilities([]);
        } else if (facilitiesRes) {
          const data = (await facilitiesRes.json()) as ArcGISQueryResponse;
          if (data.error) throw new Error(data.error.message);
          if (!cancelled) setFacilities((data.features ?? []).map((f) => f.attributes));
        }

        const keepOpenRes = await authedFetch('facilities/keep-open');
        if (keepOpenRes.ok) {
          const keepOpenData = (await keepOpenRes.json()) as { keepOpenIds: number[] };
          if (!cancelled) setKeepOpenIds(new Set(keepOpenData.keepOpenIds));
        }

        const cfg = await getFieldConfig(resolvedApiBase, tok);
        if (!cancelled) setFieldConfig(cfg);
      } catch (err) {
        if (!cancelled) setLoadError(t('common.error'));
        console.error('AdminPanel load error:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadFacilities();
    return () => { cancelled = true; };
  }, [userEmail, authedFetch, t]);

  useEffect(() => {
    if (pendingToggle) {
      requestAnimationFrame(() => {
        dialogRef.current?.showModal();
        cancelBtnRef.current?.focus();
      });
    }
  }, [pendingToggle]);

  useEffect(() => {
    if (pendingDelete) {
      requestAnimationFrame(() => {
        deleteDialogRef.current?.showModal();
        deleteCancelBtnRef.current?.focus();
      });
    }
  }, [pendingDelete]);

  useEffect(() => {
    if (pendingAddrSave) {
      requestAnimationFrame(() => {
        addrDialogRef.current?.showModal();
        addrCancelBtnRef.current?.focus();
      });
    }
  }, [pendingAddrSave]);

  const initiateToggle = useCallback(
    (facility: AdminFacility, field: EditStatusField) => {
      const newValue = facility[field] !== 'Yes';
      let clearField: EditStatusField | undefined;
      if (newValue) {
        const otherField: EditStatusField =
          field === 'Warming_Active' ? 'Cooling_Active' : 'Warming_Active';
        if (facility[otherField] === 'Yes') clearField = otherField;
      }
      setPendingToggle({ facilityId: facility.ObjectID, facilityName: facility.Name, field, newValue, clearField });
    },
    [],
  );

  const handleCancel = useCallback(() => {
    dialogRef.current?.close();
    setPendingToggle(null);
  }, []);

  // Authorized API call with stale-token self-heal: the cached id token's
  // custom:facility_ids claim can lag a recent grant → 403. On a 403, force-refresh
  // the token once and retry so the claim catches up.
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
      const jsonHeaders = { 'Content-Type': 'application/json' };

      const res = await authedFetch('facilities/status', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ featureId: facilityId, field, value: newValue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      if (clearField) {
        const clearRes = await authedFetch('facilities/status', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ featureId: facilityId, field: clearField, value: false }),
        });
        if (!clearRes.ok) throw new Error(`HTTP ${clearRes.status}`);
      }

      const otherField: EditStatusField =
        field === 'Warming_Active' ? 'Cooling_Active' : 'Warming_Active';
      const facilityState = facilities.find((f) => f.ObjectID === facilityId);
      const otherIsActive = facilityState?.[otherField] === 'Yes';
      const willBeInactive = !newValue && !otherIsActive;
      if (keepOpenIds.has(facilityId) && willBeInactive) {
        void authedFetch('facilities/keep-open', {
          method: 'PATCH',
          headers: jsonHeaders,
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
  }, [pendingToggle, keepOpenIds, facilities, authedFetch, t]);

  const handleKeepOpenToggle = useCallback(
    async (facility: AdminFacility) => {
      const facilityId = facility.ObjectID;
      const nextValue = !keepOpenIds.has(facilityId);
      setKeepOpenPendingIds((prev) => new Set(prev).add(facilityId));
      try {
        const res = await authedFetch('facilities/keep-open', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
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
    [keepOpenIds, authedFetch, t],
  );

  const handleEditOpen = useCallback(async (facilityId: number) => {
    if (expandedId === facilityId) {
      setExpandedId(null);
      return;
    }
    if (notifExpandedId === facilityId) setNotifExpandedId(null);
    setExpandedId(facilityId);
    setExpandedRawAttrs(null);
    setEditValues({});
    setPickedAddr(null);
    setExpandError(null);
    setSaveAttrsError(null);
    setIsExpandLoading(true);

    try {
      const [schema, queryRes] = await Promise.all([
        getFieldSchema(),
        getPublicArcGISToken().then((token) =>
          fetch(`${FEATURE_LAYER_URL}/query?${new URLSearchParams({
            where: `OBJECTID=${facilityId}`,
            outFields: '*',
            returnGeometry: 'false',
            f: 'json',
            token,
          })}`)
        ),
      ]);

      const queryData = (await queryRes.json()) as {
        features?: Array<{ attributes: RawAttrs }>;
        error?: { message: string };
      };
      if (queryData.error) throw new Error(queryData.error.message);

      const rawAttrs = queryData.features?.[0]?.attributes ?? {};
      setExpandedRawAttrs(rawAttrs);
      setExpandedFields(schema);

      const initial: Record<string, string> = {};
      for (const f of schema) {
        const v = rawAttrs[f.name];
        initial[f.name] = v == null ? '' : String(v);
      }
      setEditValues(initial);

      // Focus first field after render
      requestAnimationFrame(() => firstEditFieldRef.current?.focus());
    } catch (err) {
      console.error('edit expand error:', err);
      setExpandError(t('admin.editFacility.loadError'));
    } finally {
      setIsExpandLoading(false);
    }
  }, [expandedId, notifExpandedId, t]);

  // Commits the attribute edit (optionally moving geometry so the map pin and
  // Get Directions coordinates follow the new address). Shared by the plain save
  // path and the geocode-confirmation path.
  const commitAttrs = useCallback(async (
    facilityId: number,
    attributes: RawAttrs,
    geometry?: { x: number; y: number; spatialReference: { wkid: number } },
  ) => {
    setIsSavingAttrs(true);
    setSaveAttrsError(null);
    try {
      const res = await authedFetch('facility/update-attributes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectId: facilityId, attributes, ...(geometry ? { geometry } : {}) }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      // Reflect edited summary fields (Name, Address) in local state immediately —
      // the card summary reads these, not the feature layer, so a re-query isn't
      // triggered on save.
      setFacilities((prev) =>
        prev.map((f) => {
          if (f.ObjectID !== facilityId) return f;
          const next = { ...f, EditDate: Date.now() };
          if (attributes.Name != null) next.Name = String(attributes.Name);
          if ('Address' in attributes) next.Address = String(attributes.Address ?? '');
          return next;
        }),
      );

      setExpandedId(null);
      setExpandedRawAttrs(null);
      setEditValues({});
      setAnnouncement(t('admin.editFacility.saveSuccess'));
      return true;
    } catch (err) {
      console.error('saveAttrs error:', err);
      setSaveAttrsError(t('admin.editFacility.saveError'));
      setAnnouncement(t('admin.editFacility.saveError'));
      return false;
    } finally {
      setIsSavingAttrs(false);
    }
  }, [authedFetch, t]);

  const handleSaveAttrs = useCallback(async (facilityId: number) => {
    setSaveAttrsError(null);

    const attributes: RawAttrs = {};
    for (const f of expandedFields) {
      const raw = editValues[f.name] ?? '';
      if (raw === '') {
        attributes[f.name] = null;
      } else if (
        f.type === 'esriFieldTypeInteger' ||
        f.type === 'esriFieldTypeSmallInteger' ||
        f.type === 'esriFieldTypeDouble' ||
        f.type === 'esriFieldTypeSingle'
      ) {
        attributes[f.name] = Number(raw);
      } else {
        attributes[f.name] = raw;
      }
    }

    // Did the Address change? If so, geocode and confirm before moving the pin.
    const addrField = expandedFields.find(isAddressField);
    const origAddr = addrField ? String(expandedRawAttrs?.[addrField.name] ?? '') : '';
    const newAddr = addrField ? (editValues[addrField.name] ?? '').trim() : '';
    const addrChanged = !!addrField && newAddr !== '' && newAddr !== origAddr.trim();

    if (!addrChanged) {
      await commitAttrs(facilityId, attributes);
      return;
    }

    // A suggestion picked from the dropdown already carries precise coords — reuse
    // them instead of re-geocoding ambiguous free text.
    if (pickedAddr && pickedAddr.text.trim() === newAddr) {
      setPendingAddrSave({ facilityId, attributes, geo: pickedAddr });
      return;
    }

    setIsSavingAttrs(true);
    let geo: GeocodeResult | null = null;
    try {
      geo = await geocodeAddress(newAddr);
    } catch (err) {
      console.error('geocode error:', err);
    } finally {
      setIsSavingAttrs(false);
    }
    // Open the confirmation dialog (geo may be null → "couldn't locate" path).
    setPendingAddrSave({ facilityId, attributes, geo });
  }, [expandedFields, expandedRawAttrs, editValues, pickedAddr, commitAttrs]);

  const handlePickAddress = useCallback(async (fieldName: string, s: AddressSuggestion) => {
    setEditValues((prev) => ({ ...prev, [fieldName]: s.text }));
    try {
      const geo = await geocodeByMagicKey(s.text, s.magicKey);
      if (geo) setPickedAddr({ ...geo, text: s.text });
    } catch (err) {
      console.error('geocode magicKey error:', err);
    }
  }, []);

  const handleAddrCancel = useCallback(() => {
    addrDialogRef.current?.close();
    setPendingAddrSave(null);
  }, []);

  // Confirm from the dialog: move the pin when a match was found, else save text only.
  const handleAddrConfirm = useCallback(async (movePin: boolean) => {
    if (!pendingAddrSave) return;
    const { facilityId, attributes, geo } = pendingAddrSave;
    const geometry = movePin && geo
      ? { x: geo.x, y: geo.y, spatialReference: { wkid: 4326 } }
      : undefined;
    addrDialogRef.current?.close();
    setPendingAddrSave(null);
    await commitAttrs(facilityId, attributes, geometry);
  }, [pendingAddrSave, commitAttrs]);

  const handleNotifOpen = useCallback(async (facilityId: number) => {
    if (notifExpandedId === facilityId) {
      setNotifExpandedId(null);
      return;
    }
    if (expandedId === facilityId) setExpandedId(null);
    setNotifExpandedId(facilityId);
    setNotifEmails('');
    setNotifLoadError(null);
    setNotifSaveError(null);
    setIsNotifLoading(true);
    try {
      const res = await authedFetch(`facilities/notifications?facilityId=${facilityId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { notificationEmails: string };
      setNotifEmails(data.notificationEmails ?? '');
    } catch (err) {
      console.error('notif load error:', err);
      setNotifLoadError(t('admin.notifications.loadError'));
    } finally {
      setIsNotifLoading(false);
    }
  }, [notifExpandedId, expandedId, authedFetch, t]);

  const handleSaveNotifications = useCallback(async (facilityId: number) => {
    setIsNotifSaving(true);
    setNotifSaveError(null);
    try {
      const res = await authedFetch('facilities/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, emails: notifEmails }),
      });
      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      setNotifExpandedId(null);
      setAnnouncement(t('admin.notifications.saveSuccess'));
    } catch (err) {
      console.error('notif save error:', err);
      setNotifSaveError(t('admin.notifications.saveError'));
    } finally {
      setIsNotifSaving(false);
    }
  }, [notifEmails, authedFetch, t]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDelete) return;
    const { facilityId } = pendingDelete;
    deleteDialogRef.current?.close();
    setPendingDelete(null);
    setIsDeletingId(facilityId);
    try {
      const res = await authedFetch('facility/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectId: facilityId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFacilities((prev) => prev.filter((f) => f.ObjectID !== facilityId));
      setExpandedId(null);
      setAnnouncement(t('admin.deleteFacility.deleteSuccess'));
    } catch (err) {
      console.error('delete error:', err);
      setAnnouncement(t('admin.deleteFacility.deleteError'));
    } finally {
      setIsDeletingId(null);
    }
  }, [pendingDelete, authedFetch, t]);

  const conflictType = pendingToggle?.clearField === 'Warming_Active'
    ? t('admin.panel.warming')
    : t('admin.panel.cooling');
  const newType = pendingToggle?.field === 'Warming_Active'
    ? t('admin.panel.warming')
    : t('admin.panel.cooling');

  const confirmMessage = pendingToggle
    ? t('admin.panel.confirmMessage', {
        name: pendingToggle.facilityName,
        status: pendingToggle.newValue ? t('admin.panel.open') : t('admin.panel.closed'),
        type: pendingToggle.field === 'Warming_Active' ? t('admin.panel.warming') : t('admin.panel.cooling'),
      })
    : '';

  const conflictWarning =
    pendingToggle?.clearField && pendingToggle.newValue
      ? t('admin.panel.conflictWarning', { newType, clearType: conflictType })
      : '';

  return (
    <div className={styles.panel}>
      {/* ARIA live region */}
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
          {(isSuperAdmin || isAdmin) && (
            <nav aria-label={t('admin.panel.adminNavLabel')} className={styles.adminNav}>
              <Link to="/admin/users" className={styles.adminNavLink}>
                {t('admin.users.navLink')}
              </Link>
              {isSuperAdmin && (
                <button
                  ref={updateFieldsBtnRef}
                  type="button"
                  className={styles.adminNavLink}
                  onClick={() => setFieldsModalOpen(true)}
                >
                  {t('admin.fieldConfig.navLink')}
                </button>
              )}
              <button
                ref={updatePopupBtnRef}
                type="button"
                className={styles.adminNavLink}
                onClick={() => setPopupModalOpen(true)}
              >
                {t('admin.popupConfig.navLink')}
              </button>
            </nav>
          )}
        </div>
        <button onClick={signOut} className={styles.signOutBtn} type="button">
          {t('admin.panel.signOut')}
        </button>
      </div>

      <section aria-labelledby="facilities-heading">
        <div className={styles.sectionHeadingRow}>
          <h2 id="facilities-heading" className={styles.sectionHeading}>
            {t('admin.panel.facilities')}
          </h2>
          {canAddFacility ? (
            <button
              ref={addNewBtnRef}
              type="button"
              className={styles.addNewBtn}
              onClick={() => setAddModalOpen(true)}
              aria-label={t('admin.addFacility.buttonAriaLabel')}
            >
              {t('admin.addFacility.buttonLabel')}
            </button>
          ) : showRequestAccess ? (
            <button
              type="button"
              className={styles.addNewBtn}
              onClick={() => void handleRequestAccess()}
              disabled={requestAccessPending || requestAccessSent}
              aria-label={t('admin.requestAccess.buttonAriaLabel')}
            >
              {requestAccessSent
                ? t('admin.requestAccess.sentLabel')
                : requestAccessPending
                  ? t('admin.requestAccess.sending')
                  : t('admin.requestAccess.buttonLabel')}
            </button>
          ) : null}
        </div>

        {isLoading && (
          <div className={styles.loadingState} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            {t('admin.panel.loading')}
          </div>
        )}

        {loadError && !isLoading && (
          <p className={styles.errorMsg} role="alert">{loadError}</p>
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
              const isExpanded = expandedId === facility.ObjectID;
              const isNotifExpanded = notifExpandedId === facility.ObjectID;
              const editTs = facility.EditDate;
              // Lock an active toggle when Keep Open is set and it's the only active toggle
              const warmingLocked = isKeptOpen && isWarmingActive && !isCoolingActive;
              const coolingLocked = isKeptOpen && isCoolingActive && !isWarmingActive;

              return (
                <li
                  key={facility.ObjectID}
                  className={`${styles.facilityCard} ${isKeptOpen ? styles.facilityCardKeptOpen : ''}`}
                >
                  <div className={styles.facilityCardTop}>
                    <div className={styles.facilityInfo}>
                      <div className={styles.facilityNameRow}>
                        <h3 className={styles.facilityName}>{facility.Name}</h3>
                        <button
                          type="button"
                          className={styles.editLink}
                          aria-expanded={isExpanded}
                          aria-controls={`edit-form-${facility.ObjectID}`}
                          onClick={() => void handleEditOpen(facility.ObjectID)}
                        >
                          {isExpanded ? t('admin.editFacility.cancelLink') : t('admin.editFacility.editLink')}
                        </button>
                        <button
                          type="button"
                          className={styles.editLink}
                          aria-expanded={isNotifExpanded}
                          aria-controls={`notif-form-${facility.ObjectID}`}
                          onClick={() => void handleNotifOpen(facility.ObjectID)}
                        >
                          {isNotifExpanded ? t('admin.notifications.cancelLink') : t('admin.notifications.link')}
                        </button>
                      </div>
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
                          isLocked={warmingLocked}
                          onToggle={() => initiateToggle(facility, 'Warming_Active')}
                        />
                        <ToggleSwitch
                          label={t('admin.panel.coolingActive')}
                          facilityName={facility.Name}
                          isActive={isCoolingActive}
                          isPending={updatingKeys.has(coolingKey)}
                          isLocked={coolingLocked}
                          onToggle={() => initiateToggle(facility, 'Cooling_Active')}
                        />
                      </div>

                      <div className={styles.keepOpenRow}>
                        <label className={styles.keepOpenLabel}>
                          <input
                            type="checkbox"
                            className={styles.keepOpenCheckbox}
                            checked={isKeptOpen}
                            disabled={isKeepOpenPending || (!isWarmingActive && !isCoolingActive)}
                            onChange={() => void handleKeepOpenToggle(facility)}
                            aria-label={t('admin.panel.keepOpenAria', { name: facility.Name })}
                          />
                          {t('admin.panel.keepOpen')}
                        </label>
                        <div className={styles.tooltipWrapper}>
                          <button
                            type="button"
                            className={styles.tooltipBtn}
                            aria-label={t('admin.panel.keepOpenTooltip')}
                            aria-expanded={openTooltipId === facility.ObjectID}
                            onClick={() =>
                              setOpenTooltipId(
                                openTooltipId === facility.ObjectID ? null : facility.ObjectID,
                              )
                            }
                          >
                            <span aria-hidden="true">ⓘ</span>
                          </button>
                          {openTooltipId === facility.ObjectID && (
                            <div className={styles.tooltip} role="tooltip">
                              {t('admin.panel.keepOpenTooltip')}
                            </div>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <button
                          type="button"
                          className={styles.deleteLink}
                          disabled={isDeletingId === facility.ObjectID}
                          onClick={() =>
                            setPendingDelete({ facilityId: facility.ObjectID, facilityName: facility.Name })
                          }
                        >
                          {isDeletingId === facility.ObjectID
                            ? t('admin.deleteFacility.deleting')
                            : t('admin.deleteFacility.link')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline edit form */}
                  <div
                    id={`edit-form-${facility.ObjectID}`}
                    className={`${styles.editFormWrapper} ${isExpanded ? styles.editFormWrapperExpanded : ''}`}
                    aria-hidden={!isExpanded}
                  >
                    {isExpanded && (
                      <div className={styles.editForm}>
                        {isExpandLoading && (
                          <div className={styles.editFormSkeleton} role="status" aria-live="polite">
                            <span className={styles.spinner} aria-hidden="true" />
                            {t('admin.editFacility.loading')}
                          </div>
                        )}
                        {expandError && (
                          <p className={styles.errorMsg} role="alert">{expandError}</p>
                        )}
                        {!isExpandLoading && !expandError && expandedRawAttrs && (
                          <>
                            <div className={styles.editFieldList}>
                              {applyFieldConfig(expandedFields, fieldConfig).map((f, idx) => (
                                <InlineFieldInput
                                  key={f.name}
                                  field={f}
                                  value={editValues[f.name] ?? ''}
                                  onChange={(name, val) => setEditValues((prev) => ({ ...prev, [name]: val }))}
                                  isAddress={isAddressField(f)}
                                  onPickAddress={(s) => void handlePickAddress(f.name, s)}
                                  addressListboxLabel={t('admin.editFacility.addressSuggestionsLabel')}
                                  inputRef={idx === 0 ? (el) => { firstEditFieldRef.current = el; } : undefined}
                                />
                              ))}
                            </div>
                            {saveAttrsError && (
                              <p className={styles.errorMsg} role="alert" aria-live="assertive">
                                {saveAttrsError}
                              </p>
                            )}
                            <div className={styles.editFormActions}>
                              <button
                                type="button"
                                className={styles.btnPrimary}
                                disabled={isSavingAttrs}
                                onClick={() => void handleSaveAttrs(facility.ObjectID)}
                              >
                                {isSavingAttrs ? (
                                  <>
                                    <span className={styles.spinner} aria-hidden="true" />
                                    {t('admin.editFacility.saving')}
                                  </>
                                ) : (
                                  t('admin.editFacility.save')
                                )}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Notifications section */}
                  <div
                    id={`notif-form-${facility.ObjectID}`}
                    className={`${styles.editFormWrapper} ${isNotifExpanded ? styles.editFormWrapperExpanded : ''}`}
                    aria-hidden={!isNotifExpanded}
                  >
                    {isNotifExpanded && (
                      <div className={styles.editForm}>
                        {isNotifLoading && (
                          <div className={styles.editFormSkeleton} role="status" aria-live="polite">
                            <span className={styles.spinner} aria-hidden="true" />
                            {t('admin.notifications.loading')}
                          </div>
                        )}
                        {notifLoadError && (
                          <p className={styles.errorMsg} role="alert">{notifLoadError}</p>
                        )}
                        {!isNotifLoading && !notifLoadError && (
                          <>
                            <div className={styles.inlineFormGroup}>
                              <label
                                htmlFor={`notif-emails-${facility.ObjectID}`}
                                className={styles.inlineFieldLabel}
                              >
                                {t('admin.notifications.label')}
                              </label>
                              <textarea
                                id={`notif-emails-${facility.ObjectID}`}
                                className={styles.notifEmailsInput}
                                value={notifEmails}
                                placeholder={t('admin.notifications.placeholder')}
                                rows={3}
                                onChange={(e) => setNotifEmails(e.target.value)}
                              />
                              <p className={styles.notifHint}>{t('admin.notifications.hint')}</p>
                            </div>
                            {notifSaveError && (
                              <p className={styles.errorMsg} role="alert" aria-live="assertive">
                                {notifSaveError}
                              </p>
                            )}
                            <div className={styles.editFormActions}>
                              <button
                                type="button"
                                className={styles.btnPrimary}
                                disabled={isNotifSaving}
                                onClick={() => void handleSaveNotifications(facility.ObjectID)}
                              >
                                {isNotifSaving ? (
                                  <>
                                    <span className={styles.spinner} aria-hidden="true" />
                                    {t('admin.notifications.saving')}
                                  </>
                                ) : (
                                  t('admin.notifications.save')
                                )}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Confirmation dialog */}
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

      {/* Delete confirmation dialog */}
      <dialog
        ref={deleteDialogRef}
        className={styles.dialog}
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
      >
        <h2 id="delete-dialog-title" className={styles.dialogTitle}>
          {t('admin.deleteFacility.confirmTitle')}
        </h2>
        <p className={styles.dialogMessage}>
          {pendingDelete
            ? t('admin.deleteFacility.confirmMessage', { name: pendingDelete.facilityName })
            : ''}
        </p>
        <div className={styles.dialogActions}>
          <button
            type="button"
            ref={deleteCancelBtnRef}
            onClick={() => { deleteDialogRef.current?.close(); setPendingDelete(null); }}
            className={styles.btnSecondary}
          >
            {t('admin.panel.confirmNo')}
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteConfirm()}
            className={styles.btnDanger}
          >
            {t('admin.deleteFacility.confirmYes')}
          </button>
        </div>
      </dialog>

      {/* Address changed → move map pin confirmation */}
      <dialog
        ref={addrDialogRef}
        className={styles.dialog}
        aria-modal="true"
        aria-labelledby="addr-dialog-title"
      >
        <h2 id="addr-dialog-title" className={styles.dialogTitle}>
          {t('admin.editFacility.movePinTitle')}
        </h2>
        {pendingAddrSave?.geo ? (
          <>
            <p className={styles.dialogMessage}>
              {t('admin.editFacility.movePinMessage')}
            </p>
            <p className={styles.dialogMessage}>
              <strong>{pendingAddrSave.geo.matchAddr}</strong>
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                ref={addrCancelBtnRef}
                onClick={handleAddrCancel}
                className={styles.btnSecondary}
              >
                {t('admin.panel.confirmNo')}
              </button>
              <button
                type="button"
                onClick={() => void handleAddrConfirm(false)}
                className={styles.btnSecondary}
              >
                {t('admin.editFacility.saveTextOnly')}
              </button>
              <button
                type="button"
                onClick={() => void handleAddrConfirm(true)}
                className={styles.btnPrimary}
              >
                {t('admin.editFacility.movePinConfirm')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.dialogMessage}>
              {t('admin.editFacility.movePinNotFound')}
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                ref={addrCancelBtnRef}
                onClick={handleAddrCancel}
                className={styles.btnSecondary}
              >
                {t('admin.panel.confirmNo')}
              </button>
              <button
                type="button"
                onClick={() => void handleAddrConfirm(false)}
                className={styles.btnPrimary}
              >
                {t('admin.editFacility.saveTextOnly')}
              </button>
            </div>
          </>
        )}
      </dialog>

      <AddFacilityModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onFacilityAdded={(newFacility) => {
          setFacilities((prev) => [...prev, newFacility]);
          setAnnouncement(t('admin.addFacility.saveSuccess'));
          // The addFacility Lambda updated custom:facility_ids in Cognito, but the
          // cached JWT still has the old claim. Force a refresh so any immediate
          // action on the new facility (edit attributes, set notifications, delete)
          // uses a token that includes the new facility ID.
          void fetchAuthSession({ forceRefresh: true }).then((session) => {
            const tok = session.tokens?.idToken?.toString() ?? '';
            if (tok) setIdToken(tok);
          });
        }}
        apiBase={resolvedApiBase}
        idToken={idToken}
        triggerRef={addNewBtnRef}
      />

      {isSuperAdmin && (
        <UpdateFieldsModal
          isOpen={fieldsModalOpen}
          onClose={() => setFieldsModalOpen(false)}
          onSaved={(fields) => {
            setFieldConfig(fields);
            setAnnouncement(t('admin.fieldConfig.saveSuccess'));
          }}
          apiBase={resolvedApiBase}
          idToken={idToken}
          triggerRef={updateFieldsBtnRef}
        />
      )}

      {(isSuperAdmin || isAdmin) && (
        <UpdatePopupModal
          isOpen={popupModalOpen}
          onClose={() => setPopupModalOpen(false)}
          onSaved={() => setAnnouncement(t('admin.popupConfig.saveSuccess'))}
          apiBase={resolvedApiBase}
          idToken={idToken}
          triggerRef={updatePopupBtnRef}
        />
      )}
    </div>
  );
}

interface ToggleSwitchProps {
  label: string;
  facilityName: string;
  isActive: boolean;
  isPending: boolean;
  isLocked?: boolean;
  onToggle: () => void;
}

function ToggleSwitch({ label, facilityName, isActive, isPending, isLocked, onToggle }: ToggleSwitchProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.toggle}>
      <span className={styles.toggleLabel}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={isActive}
        aria-label={`${label} — ${facilityName}`}
        disabled={isPending || isLocked}
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

interface InlineFieldInputProps {
  field: FieldDef;
  value: string;
  onChange: (name: string, value: string) => void;
  isAddress?: boolean;
  onPickAddress?: (s: AddressSuggestion) => void;
  addressListboxLabel?: string;
  inputRef?: (el: HTMLInputElement | HTMLSelectElement | null) => void;
}

function InlineFieldInput({
  field,
  value,
  onChange,
  isAddress,
  onPickAddress,
  addressListboxLabel,
  inputRef,
}: InlineFieldInputProps) {
  const id = `inline-${field.name}`;
  const required = field.nullable === false;

  if (isAddress && onPickAddress) {
    return (
      <div className={styles.inlineFormGroup}>
        <label htmlFor={id} className={styles.inlineFieldLabel}>
          {field.alias}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        <AddressAutocomplete
          id={id}
          value={value}
          required={required}
          inputClassName={styles.inlineFieldInput}
          listboxLabel={addressListboxLabel ?? 'Address suggestions'}
          onChange={(val) => onChange(field.name, val)}
          onPick={onPickAddress}
          inputRef={inputRef as (el: HTMLInputElement | null) => void}
        />
      </div>
    );
  }

  if (field.name === 'Hours') {
    return (
      <div className={styles.inlineFormGroup}>
        <label htmlFor={id} className={styles.inlineFieldLabel}>
          {field.alias}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        <HoursEditor id={id} value={value} onChange={(v) => onChange(field.name, v)} required={required} />
      </div>
    );
  }

  if (field.domain?.type === 'codedValue' && field.domain.codedValues?.length) {
    return (
      <div className={styles.inlineFormGroup}>
        <label htmlFor={id} className={styles.inlineFieldLabel}>
          {field.alias}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        <select
          id={id}
          className={styles.inlineFieldInput}
          value={value}
          required={required}
          ref={inputRef as React.RefCallback<HTMLSelectElement>}
          onChange={(e) => onChange(field.name, e.target.value)}
        >
          <option value="" />
          {field.domain.codedValues.map((cv) => (
            <option key={String(cv.code)} value={String(cv.code)}>{cv.name}</option>
          ))}
        </select>
      </div>
    );
  }

  let type = 'text';
  let step: string | undefined;
  if (field.type === 'esriFieldTypeInteger' || field.type === 'esriFieldTypeSmallInteger') {
    type = 'number'; step = '1';
  } else if (field.type === 'esriFieldTypeDouble' || field.type === 'esriFieldTypeSingle') {
    type = 'number'; step = 'any';
  } else if (field.type === 'esriFieldTypeDate') {
    type = 'date';
  }

  return (
    <div className={styles.inlineFormGroup}>
      <label htmlFor={id} className={styles.inlineFieldLabel}>
        {field.alias}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        step={step}
        className={styles.inlineFieldInput}
        value={value}
        required={required}
        ref={inputRef as React.RefCallback<HTMLInputElement>}
        onChange={(e) => onChange(field.name, e.target.value)}
      />
    </div>
  );
}
