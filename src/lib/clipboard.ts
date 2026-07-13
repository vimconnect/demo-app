/**
 * Copy text to the clipboard from a user gesture.
 *
 * The app runs inside the extension's iframe, where the async Clipboard API is
 * gated by the `clipboard-write` Permissions Policy the parent frame does not
 * delegate — so `navigator.clipboard.writeText` throws regardless of the click.
 * We try it first (works when the page is top-level), then fall back to the
 * legacy `execCommand('copy')`, which is governed differently and still works
 * from a user gesture inside a restricted iframe.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked by permissions policy — fall through to the legacy path.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
