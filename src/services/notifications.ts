import * as Notifications from 'expo-notifications';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { runtimeFeatures } from '../config/features';
import { db } from '../firebase';
import { UserProfile } from '../types';

export async function registerPushToken(profile: UserProfile) {
  if (!runtimeFeatures.firebaseFunctions) return null;

  const permission = await Notifications.getPermissionsAsync();
  const finalPermission = permission.granted ? permission : await Notifications.requestPermissionsAsync();
  if (!finalPermission.granted) return null;

  const token = await Notifications.getExpoPushTokenAsync();
  await setDoc(
    doc(db, 'users', profile.id, 'pushTokens', token.data),
    {
      token: token.data,
      organizationId: profile.organizationId,
      role: profile.role,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return token.data;
}
