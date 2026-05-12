import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { HouseholdService, InviteError } from '../../data/household.service';
import { isCompleteCode, normaliseInviteCode } from '../../data/invite-code';

type Mode = 'chooser' | 'create' | 'share' | 'join';

@Component({
  selector: 'app-onboarding',
  imports: [],
  templateUrl: './onboarding.page.html',
})
export class OnboardingPage {
  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly user = this.auth.user;

  /**
   * True when reached via /households/add (existing user adding another
   * household) vs /onboarding (first-time setup). Drives the heading copy.
   */
  protected readonly addMode = this.router.url.startsWith('/households');

  constructor() {
    // Deep-link: /onboarding?code=FAM-7K2P pre-fills join mode.
    const codeParam = this.route.snapshot.queryParamMap.get('code');
    if (codeParam) {
      this.inviteCode.set(normaliseInviteCode(codeParam));
      this.mode.set('join');
    }
  }

  protected readonly mode = signal<Mode>('chooser');
  protected readonly householdName = signal('');
  protected readonly inviteCode = signal('');
  protected readonly busy = signal(false);
  protected readonly errorMsg = signal<string | null>(null);

  // Set after successful create — the code shown on the share screen.
  protected readonly createdCode = signal<string | null>(null);
  protected readonly copied = signal<'code' | 'link' | null>(null);

  protected readonly firstName = computed(() => {
    const u = this.user();
    if (!u) return 'there';
    if (u.displayName) return u.displayName.split(' ')[0];
    if (u.email) return u.email.split('@')[0];
    return 'there';
  });

  protected readonly inviteCodeNormalised = computed(() => normaliseInviteCode(this.inviteCode()));
  protected readonly canSubmitJoin = computed(() => isCompleteCode(this.inviteCode()));

  setMode(m: Mode) {
    this.errorMsg.set(null);
    this.mode.set(m);
  }

  async submitCreate(e: SubmitEvent) {
    e.preventDefault();
    if (this.busy()) return;
    const name = this.householdName().trim();
    if (!name) {
      this.errorMsg.set('Pick a name for your household.');
      return;
    }
    this.busy.set(true);
    this.errorMsg.set(null);
    try {
      const { inviteCode } = await this.households.createHousehold(name);
      this.createdCode.set(inviteCode);
      this.mode.set('share');
    } catch (err) {
      console.error(err);
      this.errorMsg.set(err instanceof Error ? err.message : 'Could not create household.');
    } finally {
      this.busy.set(false);
    }
  }

  async submitJoin(e: SubmitEvent) {
    e.preventDefault();
    if (this.busy()) return;
    if (!this.canSubmitJoin()) {
      this.errorMsg.set('Enter the full 7-character code.');
      return;
    }
    this.busy.set(true);
    this.errorMsg.set(null);
    try {
      await this.households.joinByCode(this.inviteCode());
      await this.router.navigateByUrl('/today');
    } catch (err) {
      if (err instanceof InviteError) {
        this.errorMsg.set(err.message);
      } else {
        console.error(err);
        this.errorMsg.set('Could not join household. Please try again.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  async copyCode() {
    const code = this.createdCode();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set('code');
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      this.errorMsg.set('Clipboard unavailable. Long-press the code to copy.');
    }
  }

  async copyLink() {
    const code = this.createdCode();
    if (!code) return;
    const url = `${window.location.origin}/onboarding?code=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set('link');
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      this.errorMsg.set('Clipboard unavailable.');
    }
  }

  async finish() {
    await this.router.navigateByUrl('/today');
  }

  /** Update the invite code as the user types in any segment input. */
  onCodeInput(value: string) {
    this.inviteCode.set(normaliseInviteCode(value));
  }
}
