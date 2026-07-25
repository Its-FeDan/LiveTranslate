class RelayPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 2048;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let sourceOffset = 0;
    while (sourceOffset < channel.length) {
      const copyLength = Math.min(
        channel.length - sourceOffset,
        this.chunkSize - this.offset,
      );
      this.buffer.set(
        channel.subarray(sourceOffset, sourceOffset + copyLength),
        this.offset,
      );
      this.offset += copyLength;
      sourceOffset += copyLength;

      if (this.offset === this.chunkSize) {
        const completed = this.buffer;
        this.port.postMessage(completed.buffer, [completed.buffer]);
        this.buffer = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("relay-pcm-capture", RelayPcmCaptureProcessor);
