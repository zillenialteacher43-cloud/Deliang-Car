export class RacingAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private screechGain: GainNode | null = null;
  private nitroGain: GainNode | null = null;
  private initialized = false;
  private muted = false;

  public init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.28;
      this.masterGain.connect(this.ctx.destination);

      // Engine synth (dual oscillators through warm lowpass filter)
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 380;
      this.engineFilter.Q.value = 2.2;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;

      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.value = 55;

      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'triangle';
      this.osc2.frequency.value = 110;

      this.osc1.connect(this.engineFilter);
      this.osc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.osc1.start();
      this.osc2.start();

      // White noise buffer for tire drift screech & nitro whoosh
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      // Screech chain
      const screechSrc = this.ctx.createBufferSource();
      screechSrc.buffer = noiseBuffer;
      screechSrc.loop = true;

      const screechFilter = this.ctx.createBiquadFilter();
      screechFilter.type = 'bandpass';
      screechFilter.frequency.value = 1850;
      screechFilter.Q.value = 6.0;

      this.screechGain = this.ctx.createGain();
      this.screechGain.gain.value = 0;

      screechSrc.connect(screechFilter);
      screechFilter.connect(this.screechGain);
      this.screechGain.connect(this.masterGain);
      screechSrc.start();

      // Nitro whoosh chain
      const nitroSrc = this.ctx.createBufferSource();
      nitroSrc.buffer = noiseBuffer;
      nitroSrc.loop = true;

      const nitroFilter = this.ctx.createBiquadFilter();
      nitroFilter.type = 'lowpass';
      nitroFilter.frequency.value = 720;

      this.nitroGain = this.ctx.createGain();
      this.nitroGain.gain.value = 0;

      nitroSrc.connect(nitroFilter);
      nitroFilter.connect(this.nitroGain);
      this.nitroGain.connect(this.masterGain);
      nitroSrc.start();

      this.initialized = true;
    } catch {
      // Ignore audio errors when blocked
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.28, this.ctx.currentTime, 0.05);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public update(rpmRatio: number, speedKmh: number, isDrifting: boolean, isNitro: boolean, active: boolean): void {
    if (!this.initialized || !this.ctx || !this.osc1 || !this.osc2 || !this.engineFilter || !this.engineGain) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.screechGain?.gain.setTargetAtTime(0, now, 0.05);
      this.nitroGain?.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const baseFreq = 46 + rpmRatio * 145 + (isNitro ? 28 : 0);
    this.osc1.frequency.setTargetAtTime(baseFreq, now, 0.04);
    this.osc2.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.04);
    this.engineFilter.frequency.setTargetAtTime(240 + rpmRatio * 1200 + (isNitro ? 500 : 0), now, 0.05);
    this.engineGain.gain.setTargetAtTime(0.18 + rpmRatio * 0.16, now, 0.05);

    if (this.screechGain) {
      const targetScreech = isDrifting && speedKmh > 45 ? 0.14 : 0;
      this.screechGain.gain.setTargetAtTime(targetScreech, now, 0.06);
    }
    if (this.nitroGain) {
      const targetNitro = isNitro ? 0.22 : 0;
      this.nitroGain.gain.setTargetAtTime(targetNitro, now, 0.05);
    }
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
