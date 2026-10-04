// Opening scripts by drag and drop: files from Explorer, files that have no
// path on disk (dragged out of a browser or a mail attachment) and text
// highlighted in another app.

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const LINK_ONLY = /^\s*(https?|file):\/\/\S+\s*$/i;

/** What a drag carries: 'file', 'text' or null (nothing we can open). */
export function dropKind(dataTransfer) {
  const types = [...(dataTransfer?.types || [])];
  if (types.includes('Files')) return 'file';
  if (types.includes('text/plain')) return 'text';
  return null;
}

/**
 * Open whatever was dropped as the script. Must be called from the drop event
 * itself: the dropped data is only readable until the handler returns.
 * @returns {Promise<{ ok: boolean, message?: string, notified?: boolean }>} `notified`: the
 *   prompter already showed `message`.
 */
export async function openDropped(api, dataTransfer) {
  const file = dataTransfer?.files?.[0];
  if (file) {
    const path = api.pathForFile(file);
    if (path) return { ok: !!(await api.openScriptPath(path)) };
    if (file.size > MAX_FILE_BYTES) return { ok: false, message: 'That file is too large for a script (over 25 MB).' };
    return api.openScriptText(await file.text(), file.name);
  }
  const text = dataTransfer?.getData('text/plain') || '';
  if (!text.trim()) return { ok: false };
  if (LINK_ONLY.test(text)) return { ok: false, message: 'That’s a link — drop the text itself, or save the page as a file first.' };
  return api.openScriptText(text, '');
}
