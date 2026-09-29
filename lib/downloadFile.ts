import * as FileSystem from 'expo-file-system';
import { Linking, Platform } from 'react-native';

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Saves a remote file onto the phone. Android: the user picks a folder
 * (e.g. Downloads) and the file is written there. iOS: opens the file in
 * Safari, whose share sheet offers "Save to Files".
 */
export async function downloadToDevice(url: string, fileName: string): Promise<'saved' | 'opened' | 'cancelled'> {
  const safeName = (fileName || 'document.pdf').replace(/[\\/:*?"<>|]/g, '_');
  if (Platform.OS !== 'android') {
    await Linking.openURL(url);
    return 'opened';
  }
  const ext = (safeName.split('.').pop() || 'pdf').toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const SAF = FileSystem.StorageAccessFramework;
  const perm = await SAF.requestDirectoryPermissionsAsync();
  if (!perm.granted) return 'cancelled';

  const tmp = `${FileSystem.cacheDirectory}${Date.now()}-${safeName}`;
  const res = await FileSystem.downloadAsync(url, tmp);
  if (res.status < 200 || res.status >= 300) throw new Error('Could not download the file.');
  const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
  const dest = await SAF.createFileAsync(perm.directoryUri, safeName.replace(/\.[^.]+$/, ''), mime);
  await FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 });
  FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  return 'saved';
}
