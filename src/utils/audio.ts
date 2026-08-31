import { SoundType } from '../types';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioCtxClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playAlertSound(type: SoundType, volume: number = 0.8, customAudioUrl?: string): void {
  if (volume <= 0) return;

  try {
    if (type === 'custom' && customAudioUrl) {
      const audio = new Audio(customAudioUrl);
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.play().catch((err) => console.warn('Custom audio playback error:', err));
      return;
    }

    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume * 0.7, now);
    masterGain.connect(ctx.destination);

    switch (type) {
      case 'chime': {
        // High clear gentle chime (2 harmonic sines)
        [880, 1320, 1760].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.04);
          
          gain.gain.setValueAtTime(0, now + i * 0.04);
          gain.gain.linearRampToValueAtTime(0.4 / (i + 1), now + i * 0.04 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.04 + 0.6);

          osc.connect(gain);
          gain.connect(masterGain);
          osc.start(now + i * 0.04);
          osc.stop(now + i * 0.04 + 0.65);
        });
        break;
      }

      case 'beep': {
        // Crisp dual-tone electronic beep
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(950, now);
        osc.frequency.setValueAtTime(1250, now + 0.08);

        gain.gain.setValueAtTime(0.5, now);
        gain.gain.setValueAtTime(0.5, now + 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.26);
        break;
      }

      case 'siren': {
        // Urgent rising-falling alarm pulse
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.12);
        osc.frequency.linearRampToValueAtTime(600, now + 0.24);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.36);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.48);
        break;
      }

      case 'coin': {
        // Classic game coin pickup arpeggio
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(987.77, now); // B5
        osc.frequency.setValueAtTime(1318.51, now + 0.08); // E6

        gain.gain.setValueAtTime(0.6, now);
        gain.gain.setValueAtTime(0.6, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.46);
        break;
      }

      case 'scifi': {
        // Sci-fi high-tech sweep
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(2400, now + 0.18);

        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.36);
        break;
      }

      case 'fanfare': {
        // 3-note celebration triad (C5 - E5 - G5)
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          const startTime = now + idx * 0.09;
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.4, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + (idx === 2 ? 0.5 : 0.2));

          osc.connect(gain);
          gain.connect(masterGain);
          osc.start(startTime);
          osc.stop(startTime + 0.55);
        });
        break;
      }

      case 'double_ding':
      default: {
        // Two pleasant bell notes
        [1046.5, 1318.5].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const startTime = now + idx * 0.1;
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.5, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

          osc.connect(gain);
          gain.connect(masterGain);
          osc.start(startTime);
          osc.stop(startTime + 0.38);
        });
        break;
      }
    }
  } catch (err) {
    console.warn('Web Audio error:', err);
  }
}

export function speakAlert(text: string, volume: number = 1.0): void {
  if (!('speechSynthesis' in window)) return;
  if (volume <= 0) return;
  try {
    window.speechSynthesis.cancel(); // Cancel any ongoing speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.volume = Math.max(0, Math.min(1, volume));
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('Speech synthesis error:', err);
  }
}

export function triggerBrowserNotification(title: string, body: string, icon?: string): void {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon });
    } catch {
      // Ignored in restricted environments
    }
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        try {
          new Notification(title, { body, icon });
        } catch {
          // Ignored
        }
      }
    });
  }
}
