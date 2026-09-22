import { supabase } from '@/lib/supabase';

/**
 * Uploads a locally-picked file (image or document URI from expo-image-picker /
 * expo-document-picker) to a private Supabase Storage bucket. Path convention
 * matches the web app's uploaders: {tenantId}/{profileId}/{timestamp}-{filename},
 * so the same storage RLS policies (keyed off foldername[1]/foldername[2]) work
 * unchanged for uploads coming from the mobile app.
 */
export async function uploadToBucket(
  bucket: string,
  tenantId: string,
  profileId: string,
  localUri: string,
  fileName: string,
  contentType?: string,
) {
  try {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${tenantId}/${profileId}/${Date.now()}-${safeName}`;
    const arraybuffer = await fetch(localUri).then((res) => res.arrayBuffer());
    const { error } = await supabase.storage.from(bucket).upload(path, arraybuffer, {
      contentType: contentType || 'application/octet-stream',
    });
    return { path: error ? null : path, error };
  } catch (err: any) {
    return { path: null, error: err };
  }
}

/** Short-lived signed link so the owner (or an admin/manager, per bucket RLS) can view/download an uploaded file. */
export async function getSignedUrl(bucket: string, path: string) {
  if (!path) return { url: null, error: null };
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return { url: data?.signedUrl || null, error };
}
