import * as path from 'path';

/**
 * How a file maps to the media_files.file_type column.
 *
 * Resolution is mimetype-first with an extension fallback. Extension alone was
 * not enough: browsers hand us JPEGs named ".jfif"/".jpe", and files dragged in
 * without any extension at all resolved to `""` and were rejected as
 * `Unsupported file type "."`.
 */
const MIME_TYPE_MAP: Record<string, string> = {
  'image/jpeg': 'image',
  'image/pjpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
  'application/vnd.ms-excel': 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
};

const EXT_TYPE_MAP: Record<string, string> = {
  jpg: 'image', jpeg: 'image', jpe: 'image', jfif: 'image',
  png: 'image', gif: 'image', webp: 'image', svg: 'image',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc',
  xls: 'excel', xlsx: 'excel',
};

export const ALLOWED_FILE_DESCRIPTION =
  'jpg, jpeg, png, gif, webp, svg, pdf, doc, docx, xls, xlsx';

export const extensionOf = (originalname: string): string =>
  path.extname(originalname ?? '').toLowerCase().replace('.', '');

/** Returns the media_files.file_type for a file, or null when unsupported. */
export const resolveFileType = (
  mimetype?: string,
  originalname?: string,
): string | null =>
  MIME_TYPE_MAP[(mimetype ?? '').toLowerCase()] ??
  EXT_TYPE_MAP[extensionOf(originalname ?? '')] ??
  null;

/** Names what the user actually sent, so the rejection is not guesswork. */
export const describeRejectedFile = (
  mimetype?: string,
  originalname?: string,
): string => {
  const ext = extensionOf(originalname ?? '');
  if (ext) return `".${ext}"`;
  if (mimetype) return `"${mimetype}"`;
  return 'that file (no extension or content type)';
};
