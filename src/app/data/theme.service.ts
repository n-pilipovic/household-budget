import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** User-selected mode. 'system' follows prefers-color-scheme. */
  readonly mode = signal<ThemeMode>(readStored());

  /** Live OS preference (only used when mode is 'system'). */
  private readonly systemDark = signal(prefersDark());

  /** Resolved value applied to the <html> element. */
  readonly isDark = computed(() => {
    const m = this.mode();
    if (m === 'dark') return true;
    if (m === 'light') return false;
    return this.systemDark();
  });

  constructor() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', e => this.systemDark.set(e.matches));
    }
    // Apply the resolved theme to <html> whenever it changes.
    effect(() => {
      if (typeof document === 'undefined') return;
      document.documentElement.classList.toggle('dark', this.isDark());
    });
  }

  setMode(mode: ThemeMode) {
    this.mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage disabled / private mode — preference is ephemeral.
    }
  }
}

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
}

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
