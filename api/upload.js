import { randomUUID, timingSafeEqual } from 'node:crypto';
import { put } from '@vercel/blob';

const MAX_BYTES = 4 * 1024 * 1024;
const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const ALLOWED_TYPES = new Set([...Object.values(MIME_BY_EXTENSION), 'application/octet-stream']);

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function safeFilename(value) {
  const leaf = String(value || 'document').split(/[\\/]/).pop();
  const cleaned = leaf.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, '-').slice(-120);
  return cleaned || 'document';
}

function validKey(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { error: 'Method not allowed.' });
  }

  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return json(response, 403, { error: 'Cross-origin upload denied.' });
    } catch {
      return json(response, 403, { error: 'Invalid request origin.' });
    }
  }

  const expectedKey = process.env.POLICYHUB_UPLOAD_KEY;
  if (!expectedKey || expectedKey.length < 32) {
    return json(response, 503, { error: 'Upload service is not configured. Set POLICYHUB_UPLOAD_KEY in Vercel.' });
  }
  const providedKey = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!validKey(providedKey, expectedKey)) return json(response, 401, { error: 'Invalid test upload key.' });

  const url = new URL(request.url, `https://${host || 'localhost'}`);
  const filename = safeFilename(url.searchParams.get('filename'));
  const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  const contentType = String(request.headers['content-type'] || 'application/octet-stream').split(';')[0].toLowerCase();
  if (!MIME_BY_EXTENSION[extension] || !ALLOWED_TYPES.has(contentType)) {
    return json(response, 415, { error: 'Upload a PDF, DOC, DOCX, XLS, or XLSX file.' });
  }

  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > MAX_BYTES) return json(response, 413, { error: 'Maximum file size is 4 MB.' });

  try {
    let fileBuffer;
    const parsedBody = request.body;
    if (Buffer.isBuffer(parsedBody)) {
      fileBuffer = parsedBody;
    } else if (parsedBody instanceof Uint8Array) {
      fileBuffer = Buffer.from(parsedBody);
    } else if (typeof parsedBody === 'string') {
      fileBuffer = Buffer.from(parsedBody);
    } else {
      const chunks = [];
      let streamedBytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        streamedBytes += buffer.length;
        if (streamedBytes > MAX_BYTES) {
          return json(response, 413, { error: 'Maximum file size is 4 MB.' });
        }
        chunks.push(buffer);
      }
      fileBuffer = Buffer.concat(chunks);
    }
    const total = fileBuffer.length;
    if (total > MAX_BYTES) return json(response, 413, { error: 'Maximum file size is 4 MB.' });
    if (!total) return json(response, 400, { error: 'The uploaded file is empty.' });

    const pathname = `policyhub-test-documents/${randomUUID()}-${filename}`;
    const blob = await put(pathname, fileBuffer, {
      access: 'private',
      contentType: MIME_BY_EXTENSION[extension],
      addRandomSuffix: false,
    });

    return json(response, 201, {
      filename,
      pathname: blob.pathname,
      size: total,
      uploadedAt: new Date().toISOString(),
      storage: 'private',
    });
  } catch (error) {
    console.error('PolicyHub upload failed:', error);
    return json(response, 500, { error: 'Upload failed. Check the Vercel Blob connection and try again.' });
  }
}
