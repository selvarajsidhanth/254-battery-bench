/* NFC tags on batteries: each tag holds a plain web link to the battery's page with ?tap.
   iPhones (XS and newer) read these in the background: hold the phone to the tag, tap the banner,
   and the battery opens with its actions. Android does the same with NFC on. No app needed. */

/** The link written to a battery's tag. Always the real site, never the demo. */
export function tagUrl(id: string, base = `${window.location.origin}${window.location.pathname}`): string {
  return `${base.replace(/\/?$/, '/')}#/b/${encodeURIComponent(id)}?tap`;
}

/** NTAG213 has 144 bytes of user memory; NTAG215 has 504. */
export const NTAG213_BYTES = 144;

/** Bytes a single NDEF URI record takes on the tag: "https://" is stored as a 1-byte prefix code,
    plus the record header (4) and the TLV wrapper and terminator (3). */
export function tagBytes(url: string): number {
  const rest = url.replace(/^https:\/\/(www\.)?/, '');
  return new TextEncoder().encode(rest).length + 1 + 4 + 3;
}
