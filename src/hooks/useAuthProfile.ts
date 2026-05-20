import { useEffect, useState } from 'react';
import { apiMe } from '../services/api';
import { subscribeToAuthChanges } from '../services/authEvents';
import { UserProfile } from '../types';

export function useAuthProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      setLoading(true);
      try {
        const apiProfile = await apiMe();
        if (mounted) setProfile(apiProfile);
      } catch {
        if (mounted) setProfile(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadProfile();
    const unsubscribe = subscribeToAuthChanges(loadProfile);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { profile, loading };
}
