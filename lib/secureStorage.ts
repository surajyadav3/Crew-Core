import 'react-native-get-random-values';
import { Platform } from 'react-native';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Supabase session payloads (JWT + refresh token + user metadata) routinely exceed
// SecureStore's ~2048-byte per-item limit on Android, which makes plain SecureStore
// unreliable as the auth storage adapter (it silently fails for larger sessions).
// This is Supabase's own documented workaround for Expo: keep the session blob in
// AsyncStorage but AES-encrypt it, and keep only the small encryption key in
// SecureStore (hardware-backed Keystore / Keychain). See:
// https://supabase.com/docs/guides/auth/quickstarts/react-native
//
// PERSISTENT LOGIN RULES (the "logged in once, stays logged in" guarantee —
// every past auto-logout traced back to breaking one of these):
//
//  1. A failed READ never deletes anything. Keychain/Keystore reads can fail
//     transiently — iOS while the phone is locked (the Live Tracking background
//     task wakes the app then), Android right after boot or under memory
//     pressure. The old adapter wiped the whole session on any read error, so
//     one bad read = logged out.
//  2. The encryption key is only ever CREATED when none exists, and never
//     because a read failed. The old getKey() treated a failed/empty read as
//     "no key yet", minted a new one and overwrote the real key — making the
//     saved session permanently undecryptable.
//  3. The key is never deleted. Keeping it is harmless; deleting it while
//     another JS runtime (the background task) is mid-write orphaned the data.
//  4. The saved session itself is only removed on an explicit, user-initiated
//     sign-out (see allowSessionRemoval). supabase-js also "removes" the session
//     on any refresh failure — including a refresh-token rotation race between
//     the foreground app and the background task, where the OTHER runtime has
//     already saved the fresh tokens. Ignoring that removal lets AuthContext
//     retry with whatever is stored and only sign out if the server really
//     rejects the session.
//  5. The key is stored AFTER_FIRST_UNLOCK so the background task can read it
//     while the phone is locked (iOS default is WHEN_UNLOCKED).

//  6. The refresh token is ALSO kept on its own in SecureStore under a
//     separate keychain service (so, on Android, a separate Keystore key).
//     expo-secure-store deletes an entry whose Keystore key it can't use
//     (BadPadding / missing alias) and returns null — when that hits the AES
//     key above, the saved session becomes undecryptable although the server
//     still accepts it, and the user landed on the login screen. The backup
//     lets AuthContext silently restore the session from that refresh token.

const KEY_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
const BACKUP_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'crewcore-session-backup',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
const BACKUP_ITEM = 'crewcore_session_rt';

export type SessionBackup = { userId: string; refreshToken: string };

/** The backed-up refresh token (rule 6), or null if none / unreadable. */
export async function readSessionBackup(): Promise<SessionBackup | null> {
  if (Platform.OS === 'web') return null;
  try {
    const raw = await SecureStore.getItemAsync(BACKUP_ITEM, BACKUP_OPTIONS);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.u && parsed?.rt ? { userId: parsed.u, refreshToken: parsed.rt } : null;
  } catch (err) {
    console.warn('[CrewCore] session backup not readable right now:', err);
    return null;
  }
}

export function writeSessionBackup(sessionJson: string) {
  let backup: string | null = null;
  try {
    const s = JSON.parse(sessionJson);
    if (s?.user?.id && s?.refresh_token) backup = JSON.stringify({ u: s.user.id, rt: s.refresh_token });
  } catch {
    return;
  }
  if (!backup) return;
  SecureStore.setItemAsync(BACKUP_ITEM, backup, BACKUP_OPTIONS)
    .catch((err) => console.warn('[CrewCore] session backup write skipped:', err));
}

/** True when a value is stored under `key`, whether or not it can be decrypted right now. */
export async function hasStoredValue(key: string): Promise<boolean> {
  try {
    return !!(await AsyncStorage.getItem(key));
  } catch {
    return false;
  }
}

let sessionRemovalAllowed = false;

/**
 * Runs `fn` with removal of the saved Supabase session permitted. Only
 * AuthContext's explicit sign-out paths use this — everything else that asks
 * to remove the session (supabase-js after a failed refresh) is ignored.
 */
export async function allowSessionRemoval<T>(fn: () => Promise<T>): Promise<T> {
  sessionRemovalAllowed = true;
  try {
    return await fn();
  } finally {
    sessionRemovalAllowed = false;
  }
}

const isAuthSessionKey = (key: string) => /^sb-.+-auth-token$/.test(key);

class LargeSecureStore {
  // Serializes key creation per key name: getItem and setItem can race to
  // create the first key right after a fresh login (see rule 2).
  private keyPromises = new Map<string, Promise<Uint8Array | null>>();

  private async getKey(name: string, create: boolean): Promise<Uint8Array | null> {
    // `_key2` is the AFTER_FIRST_UNLOCK copy (rule 5). iOS keychain updates
    // can't change an existing item's accessibility, so older builds' `_key`
    // (WHEN_UNLOCKED) is copied to `_key2` rather than rewritten — and never
    // deleted, so an interrupted copy can't lose the key.
    const keyName = `${name}_key2`;
    const legacyKeyName = `${name}_key`;
    const inFlight = this.keyPromises.get(keyName);
    if (inFlight) {
      const k = await inFlight;
      if (k || !create) return k;
    }

    const promise = (async () => {
      try {
        // Throws on a transient keychain/keystore failure — deliberately NOT
        // caught here, so the caller never mistakes "couldn't read" for
        // "there is no key" (rule 2).
        const existing = await SecureStore.getItemAsync(keyName, KEY_OPTIONS);
        if (existing) return aesjs.utils.hex.toBytes(existing);
        const legacy = await SecureStore.getItemAsync(legacyKeyName);
        if (legacy) {
          await SecureStore.setItemAsync(keyName, legacy, KEY_OPTIONS)
            .catch((err) => console.warn('[CrewCore] key copy skipped (legacy key still used):', err));
          return aesjs.utils.hex.toBytes(legacy);
        }
        if (!create) return null;
        const fresh = aesjs.utils.hex.fromBytes(crypto.getRandomValues(new Uint8Array(32)));
        await SecureStore.setItemAsync(keyName, fresh, KEY_OPTIONS);
        return aesjs.utils.hex.toBytes(fresh);
      } finally {
        this.keyPromises.delete(keyName);
      }
    })();
    this.keyPromises.set(keyName, promise);
    return promise;
  }

  async getItem(key: string): Promise<string | null> {
    let stored: string | null;
    try {
      stored = await AsyncStorage.getItem(key);
    } catch (err) {
      console.warn('[CrewCore] storage read failed (kept, will retry):', err);
      return null;
    }
    if (!stored) return null;

    // Pre-encryption plaintext session from an older build — hand it back
    // as-is; the next setItem() re-saves it encrypted.
    if (stored.startsWith('{') || stored.startsWith('[')) {
      try {
        JSON.parse(stored);
        return stored;
      } catch {
        // Not valid JSON either — fall through to the encrypted path below.
      }
    }

    try {
      // Stored as `${ivHex}:${ciphertextHex}` — see setItem.
      const sep = stored.indexOf(':');
      if (sep === -1) throw new Error('Missing IV separator in stored value.');
      const encryptionKey = await this.getKey(key, false);
      if (!encryptionKey) {
        console.warn('[CrewCore] encryption key not readable right now (session kept):', key);
        return null;
      }
      const ivBytes = aesjs.utils.hex.toBytes(stored.slice(0, sep));
      const cipherBytes = aesjs.utils.hex.toBytes(stored.slice(sep + 1));
      const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(ivBytes));
      const plain = aesjs.utils.utf8.fromBytes(cipher.decrypt(cipherBytes));
      // CTR "decrypts" to garbage with a wrong key instead of throwing —
      // only hand back something that actually parses.
      JSON.parse(plain);
      return plain;
    } catch (err) {
      // Rule 1: never delete on a failed read.
      console.warn('[CrewCore] could not decrypt stored value right now (kept, will retry):', err);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encryptionKey = await this.getKey(key, true);
    if (!encryptionKey) throw new Error('Could not create an encryption key.');
    // Fresh random IV on every write — CTR must never reuse (key, counter).
    const ivBytes = crypto.getRandomValues(new Uint8Array(16));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(ivBytes));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await AsyncStorage.setItem(key, `${aesjs.utils.hex.fromBytes(ivBytes)}:${aesjs.utils.hex.fromBytes(encryptedBytes)}`);
    if (isAuthSessionKey(key)) writeSessionBackup(value);
  }

  async removeItem(key: string): Promise<void> {
    if (isAuthSessionKey(key) && !sessionRemovalAllowed) {
      // Rule 4 — supabase-js asking to drop the session after a failed
      // refresh. AuthContext decides whether the user is really signed out.
      console.warn('[CrewCore] ignored non-explicit removal of the saved session');
      return;
    }
    // Rule 3: the encryption key stays.
    await AsyncStorage.removeItem(key);
    if (isAuthSessionKey(key)) {
      await SecureStore.deleteItemAsync(BACKUP_ITEM, BACKUP_OPTIONS)
        .catch((err) => console.warn('[CrewCore] session backup delete skipped:', err));
    }
  }
}

/**
 * expo-secure-store has no real backing store on web (no OS keychain), and its
 * web shim doesn't fully implement the async API used above. Browsers have
 * nothing equivalent to protect an AES key in, so plain AsyncStorage
 * (localStorage on web) is the honest equivalent there.
 */
class WebStore {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  }
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }
}

export const largeSecureStore = Platform.OS === 'web' ? new WebStore() : new LargeSecureStore();
