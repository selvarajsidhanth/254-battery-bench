/* Streaming reader for WPILib .wpilog files (the format AdvantageKit and
   WPILib DataLogManager write). Reads the file in chunks so a 100+ MB log never
   sits in memory twice, and only decodes the entries the caller asks for.

   Format (v1.0): "WPILOG" + u16 version + u32 extra-header length + header,
   then records: 1 length-bitfield byte, entry id (1–4 B), payload size (1–4 B),
   timestamp in µs (1–8 B), payload. Entry 0 is the control channel
   (0 = start entry, 1 = finish, 2 = set metadata). */

export type LogValue = number | boolean | string | number[] | boolean[] | string[] | null;

export interface LogEntryInfo {
  id: number;
  name: string;
  type: string;
  metadata: string;
}

export interface ReadOptions {
  /** decide, once per entry, whether its values should be decoded */
  want: (e: LogEntryInfo) => boolean;
  /** called for every record of a wanted entry; t is seconds */
  onValue: (e: LogEntryInfo, t: number, v: LogValue) => void;
  onEntry?: (e: LogEntryInfo) => void;
  onProgress?: (fraction: number) => void;
  chunkBytes?: number;
}

export interface ReadResult {
  entries: LogEntryInfo[];
  header: string;
  firstT: number;
  lastT: number;
  records: number;
}

const td = new TextDecoder();

export function isWpilog(head: Uint8Array): boolean {
  return head.length >= 12 && td.decode(head.subarray(0, 6)) === 'WPILOG';
}

/** Decode a payload for the common WPILib types; structs come back as null. */
export function decodeValue(type: string, b: Uint8Array): LogValue {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  switch (type) {
    case 'double': return b.length >= 8 ? dv.getFloat64(0, true) : null;
    case 'float': return b.length >= 4 ? dv.getFloat32(0, true) : null;
    case 'int64': return b.length >= 8 ? Number(dv.getBigInt64(0, true)) : null;
    case 'boolean': return b.length >= 1 ? b[0] !== 0 : null;
    case 'string':
    case 'json': return td.decode(b);
    case 'double[]': { const n = b.length >> 3; const o = new Array<number>(n); for (let i = 0; i < n; i++) o[i] = dv.getFloat64(i * 8, true); return o; }
    case 'float[]': { const n = b.length >> 2; const o = new Array<number>(n); for (let i = 0; i < n; i++) o[i] = dv.getFloat32(i * 4, true); return o; }
    case 'int64[]': { const n = b.length >> 3; const o = new Array<number>(n); for (let i = 0; i < n; i++) o[i] = Number(dv.getBigInt64(i * 8, true)); return o; }
    case 'boolean[]': return Array.from(b, (x) => x !== 0);
    case 'string[]': {
      if (b.length < 4) return [];
      const n = dv.getUint32(0, true);
      const out: string[] = [];
      let p = 4;
      for (let i = 0; i < n && p + 4 <= b.length; i++) {
        const len = dv.getUint32(p, true); p += 4;
        out.push(td.decode(b.subarray(p, p + len))); p += len;
      }
      return out;
    }
    case 'struct:Pose2d': return b.length >= 24 ? [dv.getFloat64(0, true), dv.getFloat64(8, true), dv.getFloat64(16, true)] : null;
    case 'struct:ChassisSpeeds':
    case 'struct:ChassisVelocities': return b.length >= 24 ? [dv.getFloat64(0, true), dv.getFloat64(8, true), dv.getFloat64(16, true)] : null;
    default: return null;
  }
}

const readUint = (b: Uint8Array, p: number, n: number) => {
  let v = 0;
  for (let i = n - 1; i >= 0; i--) v = v * 256 + b[p + i];
  return v;
};

/** Anything with slice().arrayBuffer() works: a File, a Blob, or a wrapped buffer in tests. */
export interface ByteSource {
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export async function readWpilog(src: ByteSource, opts: ReadOptions): Promise<ReadResult> {
  const chunk = opts.chunkBytes ?? 8 * 1024 * 1024;
  const head = new Uint8Array(await src.slice(0, Math.min(src.size, 4096)).arrayBuffer());
  if (!isWpilog(head)) throw new Error('This isn’t a .wpilog file (it doesn’t start with WPILOG).');
  const hv = new DataView(head.buffer);
  const extraLen = hv.getUint32(8, true);
  let fileOff = 12 + extraLen;
  const header = td.decode(head.subarray(12, Math.min(head.length, 12 + extraLen)));

  const entries = new Map<number, LogEntryInfo>();
  const wanted = new Map<number, LogEntryInfo>();
  let firstT = Infinity, lastT = 0, records = 0;

  let buf = new Uint8Array(0); // unconsumed bytes
  let bufStart = fileOff; // file offset of buf[0]
  let p = 0;

  while (true) {
    // top up the buffer when fewer than 1 MB (or the rest of the file) is left
    const remainingInFile = src.size - (bufStart + buf.length);
    if (buf.length - p < 1 << 20 && remainingInFile > 0) {
      const next = new Uint8Array(await src.slice(bufStart + buf.length, bufStart + buf.length + chunk).arrayBuffer());
      const merged = new Uint8Array(buf.length - p + next.length);
      merged.set(buf.subarray(p), 0);
      merged.set(next, buf.length - p);
      bufStart += p;
      buf = merged;
      p = 0;
      opts.onProgress?.((bufStart + buf.length) / src.size);
    }
    if (p >= buf.length) break;

    const hb = buf[p];
    const il = (hb & 3) + 1, sl = ((hb >> 2) & 3) + 1, tl = ((hb >> 4) & 7) + 1;
    const hdr = 1 + il + sl + tl;
    if (p + hdr > buf.length) {
      if (src.size - (bufStart + buf.length) <= 0) break; // truncated tail
      continue;
    }
    const id = readUint(buf, p + 1, il);
    const size = readUint(buf, p + 1 + il, sl);
    if (p + hdr + size > buf.length) {
      if (src.size - (bufStart + buf.length) <= 0) break; // truncated tail
      // a single record bigger than the slack: force a bigger read
      const need = p + hdr + size - buf.length;
      const next = new Uint8Array(await src.slice(bufStart + buf.length, bufStart + buf.length + Math.max(chunk, need)).arrayBuffer());
      const merged = new Uint8Array(buf.length - p + next.length);
      merged.set(buf.subarray(p), 0);
      merged.set(next, buf.length - p);
      bufStart += p; buf = merged; p = 0;
      continue;
    }
    const ts = readUint(buf, p + 1 + il + sl, tl) / 1e6;
    const payload = buf.subarray(p + hdr, p + hdr + size);
    p += hdr + size;

    if (id === 0) {
      if (payload.length >= 5 && payload[0] === 0) {
        const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const eid = dv.getUint32(1, true);
        let q = 5;
        const nl = dv.getUint32(q, true); q += 4;
        const name = td.decode(payload.subarray(q, q + nl)); q += nl;
        const tlen = dv.getUint32(q, true); q += 4;
        const type = td.decode(payload.subarray(q, q + tlen)); q += tlen;
        const ml = q + 4 <= payload.length ? dv.getUint32(q, true) : 0; q += 4;
        const metadata = ml ? td.decode(payload.subarray(q, q + ml)) : '';
        const info = { id: eid, name, type, metadata };
        entries.set(eid, info);
        opts.onEntry?.(info);
        if (opts.want(info)) wanted.set(eid, info);
        else wanted.delete(eid);
      }
      continue;
    }
    records++;
    if (ts < firstT) firstT = ts;
    if (ts > lastT) lastT = ts;
    const w = wanted.get(id);
    if (w) opts.onValue(w, ts, decodeValue(w.type, payload));
  }
  opts.onProgress?.(1);
  return { entries: [...entries.values()], header, firstT: firstT === Infinity ? 0 : firstT, lastT, records };
}

/** Build a tiny .wpilog in memory (used by tests). */
export function buildWpilog(defs: { name: string; type: string }[], recs: { entry: number; t: number; v: number | boolean | string | number[] }[]): Uint8Array {
  const out: number[] = [];
  const te = new TextEncoder();
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const push = (id: number, t: number, payload: number[]) => {
    const us = Math.round(t * 1e6);
    out.push(0b0111_1111 & (3 | (3 << 2) | (7 << 4)), ...u32(id), ...u32(payload.length));
    const ts: number[] = []; let x = us; for (let i = 0; i < 8; i++) { ts.push(x % 256); x = Math.floor(x / 256); }
    out.push(...ts, ...payload);
  };
  out.push(...te.encode('WPILOG'), 0, 1, ...u32(0));
  defs.forEach((d, i) => {
    const n = te.encode(d.name), ty = te.encode(d.type);
    push(0, 0, [0, ...u32(i + 1), ...u32(n.length), ...n, ...u32(ty.length), ...ty, ...u32(0)]);
  });
  for (const r of recs) {
    const type = defs[r.entry - 1].type;
    const b: number[] = [];
    const f64 = (n: number) => { const a = new DataView(new ArrayBuffer(8)); a.setFloat64(0, n, true); for (let i = 0; i < 8; i++) b.push(a.getUint8(i)); };
    if (type === 'double') f64(r.v as number);
    else if (type === 'double[]') (r.v as number[]).forEach(f64);
    else if (type === 'boolean') b.push(r.v ? 1 : 0);
    else if (type === 'int64') { const a = new DataView(new ArrayBuffer(8)); a.setBigInt64(0, BigInt(r.v as number), true); for (let i = 0; i < 8; i++) b.push(a.getUint8(i)); }
    else if (type === 'string') b.push(...te.encode(String(r.v)));
    push(r.entry, r.t, b);
  }
  return new Uint8Array(out);
}
