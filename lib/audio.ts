export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(
      offset,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function joinFloat32Chunks(
  chunks: Float32Array[],
  targetSamples?: number,
): Float32Array {
  const available = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const length = Math.min(targetSamples ?? available, available);
  const result = new Float32Array(length);
  const skip = Math.max(0, available - length);
  let skipped = 0;
  let offset = 0;

  for (const chunk of chunks) {
    if (skipped + chunk.length <= skip) {
      skipped += chunk.length;
      continue;
    }

    const start = Math.max(0, skip - skipped);
    const slice = chunk.subarray(start);
    const remaining = length - offset;
    const copy = slice.subarray(0, remaining);
    result.set(copy, offset);
    offset += copy.length;
    skipped += chunk.length;
    if (offset >= length) break;
  }

  return result;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
