import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { Household, HouseholdService } from '../../data/household.service';
import { ThemeService, ThemeMode } from '../../data/theme.service';
import { UpdateService } from '../../data/update.service';
import { UserService } from '../../data/user.service';
import { BUILD_COMMIT, BUILD_DATE } from '../../build-info';

@Component({
  selector: 'app-settings',
  imports: [RouterLink],
  templateUrl: './settings.page.html',
})
export class SettingsPage {
  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);
  private readonly users = inject(UserService);
  private readonly updates = inject(UpdateService);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly household = this.households.currentHousehold;
  protected readonly allHouseholds = this.households.households;
  protected readonly memberProfiles = this.households.memberProfiles;

  /** Households the user is in OTHER than the currently-active one. */
  protected readonly otherHouseholds = computed<Household[]>(() => {
    const all = this.allHouseholds() ?? [];
    const currentId = this.household()?.id;
    return all.filter(h => h.id !== currentId);
  });

  // Per-row state for the "leave" confirm flow + disabled buttons.
  protected readonly leavingId = signal<string | null>(null);
  protected readonly leaveError = signal<string | null>(null);
  protected readonly switchingId = signal<string | null>(null);

  protected readonly buildDate = BUILD_DATE;
  protected readonly buildCommit = BUILD_COMMIT;

  // ---------- Editor state ----------
  // 'name' = display name; 'household' = household rename
  protected readonly editing = signal<'name' | 'household' | null>(null);
  protected readonly draft = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  // Invite-code regeneration state
  protected readonly newInviteCode = signal<string | null>(null);
  protected readonly inviteBusy = signal(false);
  protected readonly inviteError = signal<string | null>(null);
  protected readonly inviteCopied = signal(false);

  // "Check for updates" feedback
  protected readonly updateCheckBusy = signal(false);
  protected readonly updateCheckMsg = signal<string | null>(null);

  // ---------- Derived ----------
  protected readonly currentDisplayName = computed(() => {
    const u = this.user();
    if (!u) return '';
    const profile = this.memberProfiles().get(u.uid);
    return profile?.displayName ?? u.displayName ?? u.email?.split('@')[0] ?? '';
  });

  protected readonly displayInitial = computed(() => {
    const name = this.currentDisplayName();
    return (name.charAt(0) || '?').toUpperCase();
  });

  protected readonly myColorSlot = computed(() => {
    const u = this.user();
    const h = this.household();
    if (!u || !h) return '1';
    return h.memberColors?.[u.uid] ?? '1';
  });

  protected readonly members = computed(() => {
    const h = this.household();
    if (!h) return [];
    const me = this.user()?.uid;
    return h.members.map(uid => ({
      uid,
      isMe: uid === me,
      colorSlot: h.memberColors?.[uid] ?? '1',
      displayName: this.memberProfiles().get(uid)?.displayName,
      email: this.memberProfiles().get(uid)?.email,
    }));
  });

  // ---------- Editor handlers ----------
  startEditName() {
    this.error.set(null);
    this.draft.set(this.currentDisplayName());
    this.editing.set('name');
  }

  startEditHousehold() {
    this.error.set(null);
    this.draft.set(this.household()?.name ?? '');
    this.editing.set('household');
  }

  cancelEdit() {
    this.editing.set(null);
    this.draft.set('');
    this.error.set(null);
  }

  async saveEdit(e: SubmitEvent) {
    e.preventDefault();
    if (this.busy()) return;
    const value = this.draft().trim();
    const mode = this.editing();
    if (!value || !mode) {
      this.error.set('Required.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      if (mode === 'name') {
        await this.users.updateDisplayName(value);
      } else if (mode === 'household') {
        await this.households.renameHousehold(value);
      }
      this.cancelEdit();
    } catch (err) {
      console.error('saveEdit failed', err);
      this.error.set(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      this.busy.set(false);
    }
  }

  setTheme(mode: ThemeMode) {
    this.theme.setMode(mode);
  }

  // ---------- Invite code ----------
  async regenerateInvite() {
    if (this.inviteBusy()) return;
    const h = this.household();
    if (!h) return;
    this.inviteBusy.set(true);
    this.inviteError.set(null);
    this.inviteCopied.set(false);
    try {
      const code = await this.households.createInvite(h.id);
      this.newInviteCode.set(code);
    } catch (err) {
      console.error('createInvite failed', err);
      this.inviteError.set(err instanceof Error ? err.message : 'Could not generate code.');
    } finally {
      this.inviteBusy.set(false);
    }
  }

  async copyInviteCode() {
    const code = this.newInviteCode();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.inviteCopied.set(true);
      setTimeout(() => this.inviteCopied.set(false), 2000);
    } catch {
      this.inviteError.set('Clipboard unavailable. Long-press the code to copy.');
    }
  }

  // ---------- Update check ----------
  async checkForUpdates() {
    if (this.updateCheckBusy()) return;
    this.updateCheckBusy.set(true);
    this.updateCheckMsg.set(null);
    try {
      const found = await this.updates.checkNow();
      this.updateCheckMsg.set(
        found
          ? 'New version found — installing in background.'
          : 'You are on the latest version.',
      );
    } finally {
      this.updateCheckBusy.set(false);
    }
  }

  // ---------- Multi-household ----------

  async switchTo(hid: string) {
    if (this.switchingId() || hid === this.household()?.id) return;
    this.switchingId.set(hid);
    try {
      this.households.setActiveHousehold(hid);
      // Brief moment to let the realtime queries refresh under the
      // currentHousehold signal change. Then nav home so the user
      // visibly lands in the switched household.
      await new Promise(r => setTimeout(r, 50));
      await this.router.navigateByUrl('/today');
    } finally {
      this.switchingId.set(null);
    }
  }

  async leave(hid: string, isLastMember: boolean) {
    if (this.leavingId()) return;
    const msg = isLastMember
      ? 'You are the only member of this household. Leaving will orphan all its data (transactions, budgets). Continue?'
      : 'Leave this household? You will lose access to its transactions and budgets.';
    if (!window.confirm(msg)) return;
    this.leavingId.set(hid);
    this.leaveError.set(null);
    try {
      const { remaining } = await this.households.leaveHousehold(hid);
      if (remaining === 0) {
        await this.router.navigateByUrl('/onboarding');
      } else {
        await this.router.navigateByUrl('/today');
      }
    } catch (err) {
      console.error('leaveHousehold failed', err);
      this.leaveError.set(err instanceof Error ? err.message : 'Could not leave.');
    } finally {
      this.leavingId.set(null);
    }
  }

  // ---------- Sign out / nav ----------

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }

  back() {
    this.router.navigateByUrl('/today');
  }
}
