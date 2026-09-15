/**
 * Downsample the microphone to 16kHz mono 16-bit PCM and post it in 100ms
 * frames. docs/07 section 7.
 *
 * This runs on the audio rendering thread, which must never block: no
 * allocation per input block, no JSON, no awaiting. It is a plain .js file
 * because addModule loads a URL, not a bundle, so it is served from public/
 * rather than imported.
 *
 * The browser hands 128-sample blocks at the context's rate. Where the
 * context honoured a 16kHz request there is nothing to do but convert; where
 * it did not, each output sample is the mean of the input samples that fall
 * inside it. Averaging rather than picking every third sample matters:
 * dropping samples folds everything above 8kHz back down into the speech band
 * as a hiss that a transcriber hears as consonants that were never said.
 */
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetRate, frameSamples } = options.processorOptions;
    this.ratio = sampleRate / targetRate;
    this.frameSamples = frameSamples;
    this.frame = new Int16Array(frameSamples);
    this.filled = 0;
    this.sum = 0;
    this.counted = 0;
    this.position = 0;
    this.square = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this.sum += channel[i];
      this.counted += 1;
      this.position += 1;
      if (this.position < this.ratio) continue;

      this.position -= this.ratio;
      const mean = this.counted > 0 ? this.sum / this.counted : 0;
      this.sum = 0;
      this.counted = 0;

      const clamped = mean > 1 ? 1 : mean < -1 ? -1 : mean;
      // Asymmetric on purpose: signed 16-bit runs -32768 to 32767, and
      // scaling the negative half by 32767 loses the bottom of every loud
      // syllable.
      this.frame[this.filled] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      this.square += clamped * clamped;
      this.filled += 1;

      if (this.filled === this.frameSamples) {
        const pcm = this.frame.slice();
        const rms = Math.sqrt(this.square / this.frameSamples);
        this.filled = 0;
        this.square = 0;
        this.port.postMessage({ pcm, rms }, [pcm.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("pcm-downsampler", PcmDownsampler);
