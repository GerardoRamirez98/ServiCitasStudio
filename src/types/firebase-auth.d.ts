declare module 'firebase/auth' {
  import type { FirebaseApp } from 'firebase/app';

  export interface Auth {
    readonly app: FirebaseApp;
    readonly name: string;
    readonly config: unknown;
    currentUser: User | null;
  }

  export interface User {
    readonly uid: string;
    readonly email: string | null;
  }

  export interface UserCredential {
    readonly user: User;
  }

  export interface Persistence {
    readonly type: string;
  }

  export interface ReactNativeAsyncStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }

  export function getAuth(app?: FirebaseApp): Auth;
  export function initializeAuth(app: FirebaseApp, deps?: { persistence?: Persistence | Persistence[] }): Auth;
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
  export function onAuthStateChanged(auth: Auth, nextOrObserver: (user: User | null) => void): () => void;
  export function signOut(auth: Auth): Promise<void>;
  export function signInWithEmailAndPassword(auth: Auth, email: string, password: string): Promise<UserCredential>;
  export function createUserWithEmailAndPassword(auth: Auth, email: string, password: string): Promise<UserCredential>;
}
