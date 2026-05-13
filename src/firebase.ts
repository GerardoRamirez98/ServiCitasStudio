import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyD1pZMTKifsYbw6IxYZJy7-HrkTYlkSeFg',
  authDomain: 'servicitas-studio.firebaseapp.com',
  projectId: 'servicitas-studio',
  storageBucket: 'servicitas-studio.firebasestorage.app',
  messagingSenderId: '7957001509',
  appId: '1:7957001509:web:16193058972f3a9c0216cc',
  measurementId: 'G-T2XMHC19Y9',
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = (() => {
  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch {
    return getAuth(firebaseApp);
  }
})();
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, 'us-central1');
export const storage = getStorage(firebaseApp);
