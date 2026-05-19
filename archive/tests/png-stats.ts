import { inflateSync } from 'node:zlib';

export interface PngStats {
  width: number;
  height: number;
  uniqueColors: number;
  dominantColor: string;
  dominantPixels: number;
  nonDominantPixels: number;
  nonDominantRatio: number;
}

export function pngStats(buffer: Buffer): PngStats {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Expected PNG screenshot buffer');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === 'IHDR') {
      const chunk = buffer.subarray(dataStart, dataEnd);
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk.readUInt8(8);
      colorType = chunk.readUInt8(9);
    } else if (type === 'IDAT') {
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);

  const bytesPerPixel = bytesPerPixelFor(colorType);
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const previous = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);
  const colors = new Map<string, number>();

  let inputOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated.readUInt8(inputOffset);
    inputOffset++;
    inflated.copy(current, 0, inputOffset, inputOffset + rowBytes);
    inputOffset += rowBytes;
    unfilter(current, previous, bytesPerPixel, filter);

    for (let x = 0; x < width; x++) {
      const color = colorKey(current, x * bytesPerPixel, colorType);
      colors.set(color, (colors.get(color) ?? 0) + 1);
    }

    current.copy(previous);
  }

  const [dominantColor, dominantPixels] = [...colors.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0];
  const totalPixels = width * height;
  const nonDominantPixels = totalPixels - dominantPixels;

  return {
    width,
    height,
    uniqueColors: colors.size,
    dominantColor,
    dominantPixels,
    nonDominantPixels,
    nonDominantRatio: nonDominantPixels / totalPixels,
  };
}

function bytesPerPixelFor(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type ${colorType}`);
}

function colorKey(row: Buffer, offset: number, colorType: number): string {
  if (colorType === 0) {
    const gray = row[offset];
    return `${gray},${gray},${gray},255`;
  }
  if (colorType === 2) {
    return `${row[offset]},${row[offset + 1]},${row[offset + 2]},255`;
  }
  if (colorType === 4) {
    const gray = row[offset];
    return `${gray},${gray},${gray},${row[offset + 1]}`;
  }
  return `${row[offset]},${row[offset + 1]},${row[offset + 2]},${row[offset + 3]}`;
}

function unfilter(
  row: Buffer,
  previous: Buffer,
  bytesPerPixel: number,
  filter: number,
): void {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;

    if (filter === 0) continue;
    if (filter === 1) row[i] = (row[i] + left) & 0xff;
    else if (filter === 2) row[i] = (row[i] + up) & 0xff;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 0xff;
    else throw new Error(`Unsupported PNG filter ${filter}`);
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}
