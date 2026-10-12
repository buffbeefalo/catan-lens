// Tiny PNG reader for the picture tests: 8-bit RGB or RGBA, non-interlaced, filter types 0 to 4.
// Standard library only (node:zlib), so reading the fixtures needs no image package. Returns the same shape as
// a canvas getImageData call: { width, height, data } with RGBA bytes.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG file');
  let pos = 8, width = 0, height = 0, channels = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${colour}, interlace ${interlace})`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;   // length, type, body, CRC
  }
  if (!channels) throw new Error('PNG has no header');
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('PNG pixel data is truncated');
  const data = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1), filter = raw[at];
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let p;
      if (filter === 0) p = 0;
      else if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else throw new Error(`bad PNG filter type ${filter} on row ${y}`);
      cur[i] = (raw[at + 1 + i] + p) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * channels;
      data[o] = cur[s]; data[o + 1] = cur[s + 1]; data[o + 2] = cur[s + 2]; data[o + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data };
}
