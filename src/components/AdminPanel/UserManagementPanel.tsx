import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useTranslation } from 'react-i18next';
import rawOutputs from '../../../amplify_outputs.json';
import styles from './UserManagementPanel.module.css';

interface AmplifyOutputsShape {
  custom?: { API?: { facilityStatusApiUrl?: string } };
}
const apiBase =
  (rawOutputs as AmplifyOutputsShape).custom?.API?.facilityStatusApiUrl ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CognitoUser {
  username: string;
  email: string;
  status: string;
  enabled: boolean;
  facilityIds: string;
  groups: string[];
}

const PROTECTED_EMAIL = 'cjcarsley@douglascounty-ne.gov';

interface Facility {
  objectId: number;
  name: string;
  address: string;
  warmingActive: boolean;
  coolingActive: boolean;
}

interface AdminUsersResponse {
  users: CognitoUser[];
  facilities: Facility[];
}

interface Toast {
  id: string;
  type: 'success' | 'error';
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFacilityIds(idsStr: string): Set<number> {
  return new Set(
    idsStr
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0),
  );
}

function getFacilityTypeBadge(
  f: Facility,
): 'warming' | 'cooling' | 'dual' | 'inactive' {
  if (f.warmingActive && f.coolingActive) return 'dual';
  if (f.warmingActive) return 'warming';
  if (f.coolingActive) return 'cooling';
  return 'inactive';
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<
  string,
  { labelKey: string; icon: string; styleClass: string }
> = {
  CONFIRMED: {
    labelKey: 'admin.users.statusConfirmed',
    icon: '✓',
    styleClass: 'statusConfirmed',
  },
  UNCONFIRMED: {
    labelKey: 'admin.users.statusUnconfirmed',
    icon: '⏱',
    styleClass: 'statusUnconfirmed',
  },
  FORCE_CHANGE_PASSWORD: {
    labelKey: 'admin.users.statusForceChange',
    icon: 'ℹ',
    styleClass: 'statusForceChange',
  },
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const meta = STATUS_META[status] ?? {
    labelKey: 'admin.users.statusUnknown',
    icon: '?',
    styleClass: 'statusUnknown',
  };
  return (
    <span
      className={`${styles.statusBadge} ${styles[meta.styleClass]}`}
      aria-label={`${t('admin.users.tableStatus')}: ${t(meta.labelKey)}`}
    >
      <span aria-hidden="true">{meta.icon}</span>{' '}
      <span>{t(meta.labelKey)}</span>
    </span>
  );
}

// ── Facility type badge ───────────────────────────────────────────────────────

const TYPE_STYLE: Record<string, string> = {
  warming: styles.typeWarming,
  cooling: styles.typeCooling,
  dual: styles.typeDual,
  inactive: styles.typeInactive,
};

function FacilityTypeBadge({ facility }: { facility: Facility }) {
  const { t } = useTranslation('map');
  const type = getFacilityTypeBadge(facility);
  const labelKey = `facilityType.${type}` as const;
  return (
    <span className={`${styles.typeBadge} ${TYPE_STYLE[type]}`}>
      {t(labelKey)}
    </span>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <tr key={i} className={styles.skeletonRow} aria-hidden="true">
          <td><span className={styles.skeletonCell} style={{ width: '65%' }} /></td>
          <td><span className={styles.skeletonCell} style={{ width: '80%' }} /></td>
          <td><span className={styles.skeletonCell} style={{ width: '50%' }} /></td>
          <td><span className={styles.skeletonCell} style={{ width: '40%' }} /></td>
        </tr>
      ))}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface UserManagementPanelProps {
  signOut: () => void;
  userEmail: string;
}

export default function UserManagementPanel({
  signOut,
  userEmail,
}: UserManagementPanelProps) {
  const { t } = useTranslation();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<CognitoUser | null>(null);
  const [facilitySearch, setFacilitySearch] = useState('');
  const [pendingCheckboxes, setPendingCheckboxes] = useState<Set<number>>(
    new Set(),
  );
  const [pendingRoleChange, setPendingRoleChange] = useState<Set<string>>(new Set());
  const [pendingApproval, setPendingApproval] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<CognitoUser | null>(null);
  // Tracks live facility_ids per username (overrides initial data after changes)
  const [overrideFacilityIds, setOverrideFacilityIds] = useState<
    Map<string, string>
  >(new Map());
  const [toasts, setToasts] = useState<Toast[]>([]);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const editBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const facilitySearchRef = useRef<HTMLInputElement>(null);

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString() ?? '';
      const res = await fetch(`${apiBase}admin/users`, {
        headers: { Authorization: token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AdminUsersResponse;
      setUsers(data.users);
      setFacilities(data.facilities);
    } catch (err) {
      console.error('UserManagementPanel load error:', err);
      setLoadError(t('admin.users.error'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Toast helpers ────────────────────────────────────────────────────────────
  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────────
  const filteredUsers = useMemo(
    () =>
      users.filter((u) =>
        u.email.toLowerCase().includes(userSearch.toLowerCase()),
      ),
    [users, userSearch],
  );

  const filteredFacilities = useMemo(
    () =>
      facilities.filter((f) =>
        f.name.toLowerCase().includes(facilitySearch.toLowerCase()),
      ),
    [facilities, facilitySearch],
  );

  const getAssignedIds = useCallback(
    (username: string): Set<number> => {
      const idsStr =
        overrideFacilityIds.get(username) ??
        users.find((u) => u.username === username)?.facilityIds ??
        '';
      return parseFacilityIds(idsStr);
    },
    [overrideFacilityIds, users],
  );

  // ── Modal open/close ──────────────────────────────────────────────────────────
  const openModal = useCallback((user: CognitoUser) => {
    setSelectedUser(user);
    setFacilitySearch('');
    requestAnimationFrame(() => {
      dialogRef.current?.showModal();
      facilitySearchRef.current?.focus();
    });
  }, []);

  const closeModal = useCallback(() => {
    const username = selectedUser?.username;
    dialogRef.current?.close();
    setSelectedUser(null);
    requestAnimationFrame(() => {
      if (username) editBtnRefs.current.get(username)?.focus();
    });
  }, [selectedUser]);

  // Handle native dialog cancel (Escape key)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault(); // prevent default so we control focus restoration
      closeModal();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [closeModal]);

  // ── Facility assignment toggle ─────────────────────────────────────────────
  const handleFacilityToggle = useCallback(
    async (user: CognitoUser, objectId: number, isAssigned: boolean) => {
      const action = isAssigned ? 'remove' : 'add';
      setPendingCheckboxes((prev) => new Set(prev).add(objectId));

      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() ?? '';
        const res = await fetch(`${apiBase}admin/users/facilities`, {
          method: 'PATCH',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            targetUsername: user.username,
            objectId,
            action,
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error('PATCH /admin/users/facilities failed:', res.status, errText);
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { facilityIds: string };

        setOverrideFacilityIds((prev) =>
          new Map(prev).set(user.username, data.facilityIds),
        );

        const facilityName =
          facilities.find((f) => f.objectId === objectId)?.name ?? '';
        const key = action === 'add' ? 'admin.modal.assignSuccess' : 'admin.modal.removeSuccess';
        addToast('success', t(key, { facility: facilityName, email: user.email }));
      } catch {
        addToast('error', t('admin.modal.assignError'));
      } finally {
        setPendingCheckboxes((prev) => {
          const next = new Set(prev);
          next.delete(objectId);
          return next;
        });
      }
    },
    [facilities, addToast, t],
  );

  // ── Approve pending user ────────────────────────────────────────────────────
  const handleApprove = useCallback(
    async (user: CognitoUser) => {
      setPendingApproval((prev) => new Set(prev).add(user.username));
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() ?? '';
        const callRole = (group: string, action: 'add' | 'remove') =>
          fetch(`${apiBase}admin/users/role`, {
            method: 'POST',
            headers: { Authorization: token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUsername: user.username, action, group }),
          });

        const addRes = await callRole('Approved', 'add');
        if (!addRes.ok) throw new Error(`add Approved HTTP ${addRes.status}`);
        const removeRes = await callRole('PendingApproval', 'remove');
        if (!removeRes.ok) throw new Error(`remove PendingApproval HTTP ${removeRes.status}`);

        setUsers((prev) =>
          prev.map((u) =>
            u.username === user.username
              ? {
                  ...u,
                  groups: [
                    ...u.groups.filter((g) => g !== 'PendingApproval'),
                    'Approved',
                  ],
                }
              : u,
          ),
        );
        addToast('success', t('admin.users.approveSuccess', { email: user.email }));
      } catch (err) {
        console.error('approve error:', err);
        addToast('error', t('admin.users.approveError'));
      } finally {
        setPendingApproval((prev) => {
          const next = new Set(prev);
          next.delete(user.username);
          return next;
        });
      }
    },
    [addToast, t],
  );

  // ── Delete user (PROTECTED_EMAIL only) ─────────────────────────────────────
  const requestDelete = useCallback((user: CognitoUser) => {
    setConfirmDeleteUser(user);
    requestAnimationFrame(() => confirmDialogRef.current?.showModal());
  }, []);

  const cancelDelete = useCallback(() => {
    confirmDialogRef.current?.close();
    setConfirmDeleteUser(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!confirmDeleteUser) return;
    const target = confirmDeleteUser;
    setPendingDelete((prev) => new Set(prev).add(target.username));
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString() ?? '';
      const res = await fetch(`${apiBase}admin/users/delete`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUsername: target.username }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('delete user failed:', res.status, errText);
        throw new Error(`HTTP ${res.status}`);
      }
      setUsers((prev) => prev.filter((u) => u.username !== target.username));
      addToast('success', t('admin.users.deleteSuccess', { email: target.email }));
      confirmDialogRef.current?.close();
      setConfirmDeleteUser(null);
    } catch {
      addToast('error', t('admin.users.deleteError'));
    } finally {
      setPendingDelete((prev) => {
        const next = new Set(prev);
        next.delete(target.username);
        return next;
      });
    }
  }, [confirmDeleteUser, addToast, t]);

  // ── Admin role toggle ──────────────────────────────────────────────────────
  const handleRoleToggle = useCallback(
    async (user: CognitoUser, currentlyAdmin: boolean) => {
      const action = currentlyAdmin ? 'remove' : 'add';
      setPendingRoleChange((prev) => new Set(prev).add(user.username));

      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() ?? '';
        const res = await fetch(`${apiBase}admin/users/role`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUsername: user.username, action, group: 'Admin' }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error('POST /admin/users/role failed:', res.status, errText);
          throw new Error(`HTTP ${res.status}`);
        }

        setUsers((prev) =>
          prev.map((u) => {
            if (u.username !== user.username) return u;
            const newGroups =
              action === 'add'
                ? [...u.groups, 'Admin']
                : u.groups.filter((g) => g !== 'Admin');
            return { ...u, groups: newGroups };
          }),
        );

        const key =
          action === 'add' ? 'admin.users.roleGrantSuccess' : 'admin.users.roleRemoveSuccess';
        addToast('success', t(key, { email: user.email }));
      } catch {
        addToast('error', t('admin.users.roleError'));
      } finally {
        setPendingRoleChange((prev) => {
          const next = new Set(prev);
          next.delete(user.username);
          return next;
        });
      }
    },
    [addToast, t],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.panel}>
      {/* Toast container — aria-live="polite" announces each new toast */}
      <div
        className={styles.toastContainer}
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${
              toast.type === 'success' ? styles.toastSuccess : styles.toastError
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin" className={styles.backLink}>
            ← {t('admin.panel.facilities')}
          </Link>
          <h1 className={styles.heading}>{t('admin.users.heading')}</h1>
          <p className={styles.currentUser}>
            {t('admin.panel.welcome', { email: userEmail })}
          </p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className={styles.signOutBtn}
        >
          {t('admin.panel.signOut')}
        </button>
      </div>

      {/* Search */}
      <div className={styles.searchSection}>
        <label htmlFor="user-search" className={styles.searchLabel}>
          {t('admin.users.searchLabel')}
        </label>
        <input
          id="user-search"
          type="search"
          className={styles.searchInput}
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          placeholder={t('admin.users.searchPlaceholder')}
          aria-controls="users-table-body"
        />
      </div>

      {/* Error state */}
      {loadError && !isLoading && (
        <div className={styles.errorContainer} role="alert">
          <p className={styles.errorMsg}>{loadError}</p>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => void loadData()}
          >
            {t('admin.users.retry')}
          </button>
        </div>
      )}

      {/* User table */}
      {!loadError && (
        <div className={styles.tableWrapper}>
          <table className={styles.table} aria-label={t('admin.users.heading')}>
            <thead>
              <tr>
                <th scope="col">{t('admin.users.tableEmail')}</th>
                <th scope="col">{t('admin.users.tableStatus')}</th>
                <th scope="col">{t('admin.users.tableFacilities')}</th>
                <th scope="col">
                  <span className={styles.srOnly}>{t('admin.users.tableActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody id="users-table-body">
              {isLoading && <SkeletonRows />}

              {!isLoading && filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className={styles.noResults}>
                    {t('admin.users.noResults')}
                  </td>
                </tr>
              )}

              {!isLoading &&
                filteredUsers.map((user) => {
                  const count = getAssignedIds(user.username).size;
                  return (
                    <tr key={user.username} className={styles.userRow}>
                      <td className={styles.emailCell}>
                        {user.email}
                        {user.groups.includes('Admin') && (
                          <span className={styles.adminBadge} aria-label={t('admin.users.adminBadge')}>
                            {t('admin.users.adminBadge')}
                          </span>
                        )}
                        {user.groups.includes('PendingApproval') && (
                          <span className={styles.pendingBadge} aria-label={t('admin.users.pendingBadge')}>
                            {t('admin.users.pendingBadge')}
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={user.status} />
                      </td>
                      <td className={styles.facilityCountCell}>
                        {t('admin.users.facilitiesCount', { count })}
                      </td>
                      <td className={styles.actionCell}>
                        <div className={styles.actionBtns}>
                          <button
                            type="button"
                            ref={(el) => {
                              if (el) editBtnRefs.current.set(user.username, el);
                              else editBtnRefs.current.delete(user.username);
                            }}
                            className={styles.editBtn}
                            onClick={() => openModal(user)}
                            aria-label={t('admin.users.editAssignmentsAria', {
                              email: user.email,
                            })}
                          >
                            {t('admin.users.editAssignments')}
                          </button>
                          {user.groups.includes('PendingApproval') && (
                            <button
                              type="button"
                              className={styles.approveBtn}
                              onClick={() => void handleApprove(user)}
                              disabled={pendingApproval.has(user.username)}
                              aria-label={t('admin.users.approveAria', { email: user.email })}
                            >
                              {pendingApproval.has(user.username)
                                ? '…'
                                : t('admin.users.approve')}
                            </button>
                          )}
                          {!user.groups.includes('SuperAdmin') && (
                            <button
                              type="button"
                              className={
                                user.groups.includes('Admin')
                                  ? styles.removeRoleBtn
                                  : styles.grantRoleBtn
                              }
                              onClick={() =>
                                void handleRoleToggle(user, user.groups.includes('Admin'))
                              }
                              disabled={
                                pendingRoleChange.has(user.username) ||
                                (user.email === PROTECTED_EMAIL &&
                                  user.groups.includes('Admin'))
                              }
                              aria-label={
                                user.groups.includes('Admin')
                                  ? t('admin.users.removeAdminAria', { email: user.email })
                                  : t('admin.users.grantAdminAria', { email: user.email })
                              }
                            >
                              {pendingRoleChange.has(user.username)
                                ? '…'
                                : user.groups.includes('Admin')
                                  ? t('admin.users.removeAdmin')
                                  : t('admin.users.grantAdmin')}
                            </button>
                          )}
                          {userEmail === PROTECTED_EMAIL &&
                            user.email !== PROTECTED_EMAIL &&
                            !user.groups.includes('SuperAdmin') && (
                              <button
                                type="button"
                                className={styles.deleteBtn}
                                onClick={() => requestDelete(user)}
                                disabled={pendingDelete.has(user.username)}
                                aria-label={t('admin.users.deleteUserAria', { email: user.email })}
                              >
                                {pendingDelete.has(user.username)
                                  ? '…'
                                  : t('admin.users.deleteUser')}
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Facility assignment modal */}
      <dialog
        ref={dialogRef}
        className={styles.modal}
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {selectedUser && (
          <>
            <div className={styles.modalHeader}>
              <h2 id="modal-title" className={styles.modalTitle}>
                {t('admin.modal.title', { email: selectedUser.email })}
              </h2>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={closeModal}
                aria-label={t('admin.modal.close')}
              >
                ✕
              </button>
            </div>

            <div className={styles.modalSearchSection}>
              <label
                htmlFor="facility-search"
                className={styles.searchLabel}
              >
                {t('admin.modal.searchLabel')}
              </label>
              <input
                id="facility-search"
                type="search"
                ref={facilitySearchRef}
                className={styles.searchInput}
                value={facilitySearch}
                onChange={(e) => setFacilitySearch(e.target.value)}
                placeholder={t('admin.modal.searchPlaceholder')}
              />
            </div>

            <ul
              className={styles.facilityList}
              role="list"
              aria-label={t('admin.modal.facilityListLabel')}
            >
              {filteredFacilities.length === 0 && (
                <li className={styles.noResults}>
                  {t('admin.modal.noResults')}
                </li>
              )}

              {filteredFacilities.map((facility) => {
                const assignedIds = getAssignedIds(selectedUser.username);
                const isAssigned = assignedIds.has(facility.objectId);
                const isPending = pendingCheckboxes.has(facility.objectId);
                const checkId = `fc-${facility.objectId}`;

                return (
                  <li key={facility.objectId} className={styles.facilityItem}>
                    <div className={styles.checkboxWrapper}>
                      {isPending ? (
                        <span
                          className={styles.checkboxSpinner}
                          role="status"
                          aria-label={t('common.loading')}
                        />
                      ) : (
                        <input
                          id={checkId}
                          type="checkbox"
                          className={styles.facilityCheckbox}
                          checked={isAssigned}
                          onChange={() =>
                            void handleFacilityToggle(
                              selectedUser,
                              facility.objectId,
                              isAssigned,
                            )
                          }
                          aria-label={`${facility.name} — ${
                            isAssigned
                              ? t('admin.modal.assigned')
                              : t('admin.modal.notAssigned')
                          }`}
                        />
                      )}
                    </div>

                    <label
                      htmlFor={checkId}
                      className={styles.facilityInfo}
                    >
                      <span className={styles.facilityName}>{facility.name}</span>
                      <span className={styles.facilityAddress}>
                        {facility.address}
                      </span>
                    </label>

                    <FacilityTypeBadge facility={facility} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </dialog>

      <dialog
        ref={confirmDialogRef}
        className={styles.confirmDialog}
        aria-labelledby="confirm-delete-title"
      >
        {confirmDeleteUser && (
          <div className={styles.confirmInner}>
            <h2 id="confirm-delete-title" className={styles.confirmTitle}>
              {t('admin.users.deleteConfirmTitle')}
            </h2>
            <p className={styles.confirmBody}>
              {t('admin.users.deleteConfirmBody', { email: confirmDeleteUser.email })}
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancelBtn}
                onClick={cancelDelete}
                disabled={pendingDelete.has(confirmDeleteUser.username)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={styles.confirmDeleteBtn}
                onClick={() => void confirmDelete()}
                disabled={pendingDelete.has(confirmDeleteUser.username)}
              >
                {pendingDelete.has(confirmDeleteUser.username)
                  ? '…'
                  : t('admin.users.deleteUser')}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
