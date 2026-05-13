import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { UserProfile, UserRole } from '../types';

const allowedRoles: UserRole[] = ['client', 'employee', 'receptionist', 'manager', 'admin', 'owner'];

export function useAuthProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [missingProfile, setMissingProfile] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let profileUnsubscribe: (() => void) | undefined;

    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      profileUnsubscribe?.();

      if (!user) {
        setAuthUser(null);
        setProfile(null);
        setMissingProfile(false);
        setLoading(false);
        return;
      }

      setAuthUser(user);
      setLoading(true);
      profileUnsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
        const data = snapshot.data();
        if (!data) {
          setProfile(null);
          setMissingProfile(true);
          setLoading(false);
          return;
        }

        setMissingProfile(false);
        setProfile({
          id: user.uid,
          name: String(data.name ?? user.email ?? 'Usuario'),
          email: String(data.email ?? user.email ?? ''),
          role: allowedRoles.includes(data.role) ? data.role : 'client',
          organizationId: String(data.organizationId ?? ''),
          organizationName: String(data.organizationName ?? 'Mi organizacion'),
          employeeId: data.employeeId ? String(data.employeeId) : undefined,
        });
        setLoading(false);
      });
    });

    return () => {
      profileUnsubscribe?.();
      authUnsubscribe();
    };
  }, []);

  return { profile, authUser, missingProfile, loading };
}
