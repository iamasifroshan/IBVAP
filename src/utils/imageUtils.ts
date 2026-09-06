import { API_BASE_URL } from '../services/apiConfig';

/**
 * Resolves an evidence snapshot URL reliably:
 * - Direct HTTP/HTTPS URLs are passed as-is
 * - Windows filesystem paths (e.g. E:\IBVAP\...) are normalized to /storage/evidence/<filename>
 * - Bare filenames (e.g. webcam_evidence_123.jpg) are normalized to /storage/evidence/<filename>
 * - Relative /storage paths are resolved directly via Vite proxy or static asset fallback
 */
export function resolveImageUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // Strip Windows drive or filesystem path prefixes if present
  if (url.includes('\\') || /^[a-zA-Z]:/.test(url)) {
    const filename = url.split(/[\\/]/).pop();
    return filename ? `/storage/evidence/${filename}` : '';
  }
  if (!url.startsWith('/')) {
    if (url.startsWith('storage/')) {
      return `/${url}`;
    }
    return `/storage/evidence/${url}`;
  }
  return url;
}

/**
 * Resolves a full backend HTTP URL for an evidence snapshot
 */
export function resolveFullImageUrl(url: string | undefined): string {
  const relative = resolveImageUrl(url);
  if (!relative) return '';
  if (relative.startsWith('http://') || relative.startsWith('https://')) {
    return relative;
  }
  const baseUrl = API_BASE_URL.replace('/api/v1', '').replace(/\/$/, '');
  return `${baseUrl}${relative.startsWith('/') ? relative : `/${relative}`}`;
}
