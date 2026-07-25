import { describe, expect, it } from "vitest";

import { encodePcm16Wav, joinFloat32Chunks } from "@/lib/audio";

describe("joinFloat32Chunks", () => {
  it("joins all chunks in order", () => {
    const result = joinFloat32Chunks([
      new Float32Array([0, 1]),
      new Float32Array([2, 3]),
    ]);

    expect(Array.from(result)).toEqual([0, 1, 2, 3]);
  });

  it("retains the most recent samples when a target is supplied", () => {
    const result = joinFloat32Chunks(
      [new Float32Array([0, 1, 2]), new Float32Array([3, 4])],
      3,
    );

    expect(Array.from(result)).toEqual([2, 3, 4]);
  });
});

describe("encodePcm16Wav", () => {
  it("writes a valid mono PCM WAV header and clamps samples", async () => {
    const blob = encodePcm16Wav(new Float32Array([-2, 0, 2]), 16_000);
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    const ascii = (start: number, length: number) =>
      String.fromCharCode(...new Uint8Array(bytes, start, length));

    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(50);
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32_767);
  });
});
