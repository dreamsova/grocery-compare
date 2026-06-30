import { createClient } from '@supabase/supabase-js';

function configured(value) {
  const clean = value?.trim();
  return Boolean(clean && !clean.startsWith('your-') && !clean.includes('...'));
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'receipts';

const storageReady = configured(supabaseUrl) && configured(supabaseKey) && configured(bucket);
const supabase = storageReady
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

function extensionFor(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export function receiptStorageStatus() {
  return {
    active: storageReady ? 'supabase_storage' : 'sqlite_base64',
    bucket,
    configured: storageReady,
  };
}

export async function storeReceiptImage({ productId, receiptId, parsed, fileName }) {
  if (!storageReady) {
    return {
      imageData: parsed.imageData,
      storagePath: null,
    };
  }

  const safeName = fileName?.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  const ext = extensionFor(parsed.mimeType);
  const storagePath = `${productId}/${receiptId}-${safeName || 'receipt'}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, parsed.buffer, {
      contentType: parsed.mimeType,
      upsert: false,
    });

  if (error) {
    const err = new Error(`Supabase receipt upload failed: ${error.message}`);
    err.status = 502;
    throw err;
  }

  return {
    imageData: null,
    storagePath,
  };
}

export async function loadReceiptImage(receipt) {
  if (receipt?.storage_path && storageReady) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(receipt.storage_path);

    if (error) {
      const err = new Error(`Supabase receipt download failed: ${error.message}`);
      err.status = 502;
      throw err;
    }

    return Buffer.from(await data.arrayBuffer());
  }

  if (!receipt?.image_data) return null;
  return Buffer.from(receipt.image_data, 'base64');
}
