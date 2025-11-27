// AudioWorklet processor for capturing PCM audio data from tab audio
// This runs in the AudioWorklet thread (separate from main thread)

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048; // Process in small chunks for low latency
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // If we have input audio data
    if (input && input.length > 0) {
      const inputChannel = input[0]; // mono channel (or first channel if stereo)

      if (inputChannel && inputChannel.length > 0) {
        // Convert Float32Array to Int16Array (PCM 16-bit)
        const pcmData = this.float32ToInt16(inputChannel);

        // Send PCM data to main thread
        this.port.postMessage({
          type: 'pcm-data',
          pcmData: pcmData
        });
      }
    }

    // Keep processor alive
    return true;
  }

  // Convert Float32Array (-1.0 to 1.0) to Int16Array (PCM 16-bit: -32768 to 32767)
  float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);

    for (let i = 0; i < float32Array.length; i++) {
      // Clamp to -1.0 to 1.0 range
      const clamped = Math.max(-1, Math.min(1, float32Array[i]));

      // Scale to 16-bit integer range
      int16Array[i] = clamped < 0
        ? clamped * 0x8000  // -32768
        : clamped * 0x7FFF; // 32767
    }

    return int16Array;
  }
}

// Register the processor
registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
