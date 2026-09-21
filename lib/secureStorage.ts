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
class LargeSecureStore {
  private async getKey(name: string): Promise<Uint8Array> {
    const keyName = `${name}_key`;
    const existing = await SecureStore.getItemAsync(keyName);
    if (existing) return aesjs.utils.hex.toBytes(existing);
    const fresh = aesjs.utils.hex.fromBytes(crypto.getRandomValues(new Uint8Array(32)));
    await SecureStore.setItemAsync(keyName, fresh);
    return aesjs.utils.hex.toBytes(fresh);
  }

  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;

    // Migrate a pre-encryption plaintext session transparently: the old adapter
    // (plain AsyncStorage) stored the Supabase session as raw JSON under this
    // same key. Switching adapters with no migration made every existing
    // signed-in user's session fail to hex-decode below and get wiped, forcing
    // a surprise re-login. Detect that shape and hand it back as-is — the next
    // setItem() (e.g. on token refresh) re-saves it in the new encrypted format.
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
      const ivBytes = aesjs.utils.hex.toBytes(stored.slice(0, sep));
      const cipherBytes = aesjs.utils.hex.toBytes(stored.slice(sep + 1));
      const encryptionKey = await this.getKey(key);
      const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(ivBytes));
      const decryptedBytes = cipher.decrypt(cipherBytes);
      return aesjs.utils.utf8.fromBytes(decryptedBytes);
    } catch (err) {
      console.error('[CrewCore] Failed to decrypt stored session, clearing it:', err);
      await this.removeItem(key);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encryptionKey = await this.getKey(key);
    // CTR mode is only secure if (key, counter) never repeats. The key is
    // persisted and reused across every write, so the counter/IV must be
    // fresh each time — a fixed starting counter here previously meant every
    // session update reused the exact same keystream, letting two captured
    // ciphertexts for the same key be XORed together to recover the XOR of
    // their plaintexts (a classic two-time-pad break).
    const ivBytes = crypto.getRandomValues(new Uint8Array(16));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(ivBytes));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await AsyncStorage.setItem(key, `${aesjs.utils.hex.fromBytes(ivBytes)}:${aesjs.utils.hex.fromBytes(encryptedBytes)}`);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(`${key}_key`);
  }
}

/**
 * expo-secure-store has no real backing store on web (no OS keychain), and its
 * web shim doesn't fully implement the async API used above — calling it there
 * throws (e.g. "deleteValueWithKeyAsync is not a function") instead of just
 * degrading gracefully. Browsers also have nothing equivalent to hardware
 * Keystore/Keychain to protect an AES key in, so encrypting-at-rest into the
 * same origin's localStorage buys no real security there — plain AsyncStorage
 * (itself a localStorage wrapper on web) is the honest equivalent. Native
 * (Android/iOS) keeps the full encrypted LargeSecureStore unchanged.
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
