import { useState, useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

export function useAuthGroups(): {
  groups: string[];
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isLoading: boolean;
} {
  const [groups, setGroups] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchAuthSession()
      .then((session) => {
        const raw = session.tokens?.idToken?.payload['cognito:groups'];
        const g = Array.isArray(raw) ? (raw as string[]) : [];
        if (!cancelled) setGroups(g);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    groups,
    isSuperAdmin: groups.includes('SuperAdmin'),
    isAdmin: groups.includes('Admin'),
    isLoading,
  };
}
