import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Authenticator } from '@aws-amplify/ui-react';
import { useTranslation } from 'react-i18next';
import '@aws-amplify/ui-react/styles.css';
import AdminPanel from './AdminPanel';
import UserManagementPanel from '../../components/AdminPanel/UserManagementPanel';
import { useAuthGroups } from '../../hooks/useAuthGroups';
import styles from './LoginPage.module.css';

function LoadingSpinner() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        color: 'var(--color-text-secondary)',
        fontSize: '0.9375rem',
      }}
      role="status"
      aria-live="polite"
    >
      {t('common.loading')}
    </div>
  );
}

interface AuthenticatedAreaProps {
  signOut: () => void;
  userEmail: string;
  isUsersRoute: boolean;
}

function AuthenticatedArea({
  signOut,
  userEmail,
  isUsersRoute,
}: AuthenticatedAreaProps) {
  const { isSuperAdmin, isAdmin, isLoading } = useAuthGroups();
  const navigate = useNavigate();
  const canManageUsers = isSuperAdmin || isAdmin;

  // Redirect users without admin privileges away from /admin/users
  useEffect(() => {
    if (isUsersRoute && !isLoading && !canManageUsers) {
      navigate('/admin', { replace: true, state: { unauthorized: true } });
    }
  }, [isUsersRoute, isLoading, canManageUsers, navigate]);

  if (isUsersRoute) {
    if (isLoading) return <LoadingSpinner />;
    // Renders null briefly while the redirect fires
    if (!canManageUsers) return null;
    return <UserManagementPanel signOut={signOut} userEmail={userEmail} />;
  }

  return (
    <AdminPanel
      signOut={signOut}
      userEmail={userEmail}
      isSuperAdmin={isSuperAdmin}
    />
  );
}

export default function LoginPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const isUsersRoute = location.pathname.startsWith('/admin/users');

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  return (
    <div className={styles.page}>
      <div className={isUsersRoute ? styles.containerWide : styles.container}>
        {!isUsersRoute && (
          <Link to="/" className={styles.backLink}>
            ← {t('admin.login.backToMap')}
          </Link>
        )}

        <Authenticator
          className={isUsersRoute ? undefined : styles.authenticator}
          formFields={{
            signIn: {
              username: {
                label: t('admin.login.emailLabel'),
                placeholder: t('admin.login.emailPlaceholder'),
              },
            },
          }}
        >
          {({
            signOut,
            user,
          }: {
            signOut?: () => void;
            user?: { username?: string; signInDetails?: { loginId?: string } };
          }) => (
            <AuthenticatedArea
              signOut={signOut ?? (() => undefined)}
              userEmail={user?.signInDetails?.loginId ?? user?.username ?? ''}
              isUsersRoute={isUsersRoute}
            />
          )}
        </Authenticator>
      </div>
    </div>
  );
}
