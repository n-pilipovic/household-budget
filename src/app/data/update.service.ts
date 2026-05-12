import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, VersionEvent, VersionReadyEvent } from '@angular/service-worker';
import { filter, fromEvent, interval, merge } from 'rxjs';

/** How often to ask the SW to check the server for a new bundle. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly sw = inject(SwUpdate);
  private readonly destroy = inject(DestroyRef);

  /** True once a new version is ready and waiting to be activated. */
  readonly updateAvailable = signal(false);

  /** User dismissed the prompt for this session — re-arms on next tab. */
  private readonly dismissed = signal(false);

  /** True only when an update is ready AND the user hasn't dismissed it. */
  readonly showPrompt = signal(false);

  constructor() {
    if (!this.sw.isEnabled) return; // dev mode or service worker unsupported

    // Listen for the SW telling us a new version finished installing.
    this.sw.versionUpdates
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((evt: VersionEvent) => {
        if (isVersionReady(evt)) {
          this.updateAvailable.set(true);
          this.recomputeShowPrompt();
        }
      });

    // Trigger periodic checks: every hour, and whenever the tab is
    // refocused after being hidden (covers "wife opens her phone in
    // the morning after the night's deploy" cases).
    const focus$ = fromEvent(window, 'focus');
    const visibility$ = fromEvent(document, 'visibilitychange').pipe(
      filter(() => document.visibilityState === 'visible'),
    );
    const tick$ = interval(CHECK_INTERVAL_MS);

    merge(focus$, visibility$, tick$)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe(() => {
        this.sw.checkForUpdate().catch(err => {
          console.warn('checkForUpdate failed', err);
        });
      });
  }

  /** Activate the waiting SW version and reload to pick up the new bundle. */
  async applyUpdate(): Promise<void> {
    if (!this.sw.isEnabled || !this.updateAvailable()) return;
    try {
      await this.sw.activateUpdate();
    } catch (err) {
      console.error('activateUpdate failed', err);
    }
    // Hard reload so the new SW takes over all clients.
    document.location.reload();
  }

  /** Hide the prompt for this session; re-fires on the next new version. */
  dismiss(): void {
    this.dismissed.set(true);
    this.recomputeShowPrompt();
  }

  private recomputeShowPrompt(): void {
    this.showPrompt.set(this.updateAvailable() && !this.dismissed());
  }
}

function isVersionReady(evt: VersionEvent): evt is VersionReadyEvent {
  return evt.type === 'VERSION_READY';
}
