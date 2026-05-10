import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseError } from '@angular/fire/app';
import { AuthService } from '../../auth/auth.service';

type Mode = 'chooser' | 'sign-in' | 'create';

@Component({
  selector: 'app-sign-in',
  imports: [],
  templateUrl: './sign-in.page.html',
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly mode = signal<Mode>('chooser');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly errorMsg = signal<string | null>(null);

  protected readonly title = computed(() =>
    this.mode() === 'create' ? 'Create your account' : 'Welcome back'
  );
  protected readonly subtitle = computed(() =>
    this.mode() === 'create'
      ? "We'll send a verification email to confirm."
      : 'Sign in to your shared household budget.'
  );

  setMode(m: Mode) {
    this.errorMsg.set(null);
    this.mode.set(m);
  }

  async signInWithGoogle() {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    try {
      await this.auth.signInWithGoogle();
      await this.router.navigateByUrl('/today');
    } catch (err) {
      this.errorMsg.set(this.friendlyError(err));
    } finally {
      this.busy.set(false);
    }
  }

  async submitEmail(e: SubmitEvent) {
    e.preventDefault();
    if (this.busy()) return;
    const email = this.email().trim();
    const password = this.password();
    if (!email || password.length < 6) {
      this.errorMsg.set('Email + password (≥6 characters) required.');
      return;
    }
    this.busy.set(true);
    this.errorMsg.set(null);
    try {
      if (this.mode() === 'create') {
        await this.auth.createWithEmail(email, password);
      } else {
        await this.auth.signInWithEmail(email, password);
      }
      await this.router.navigateByUrl('/today');
    } catch (err) {
      this.errorMsg.set(this.friendlyError(err));
    } finally {
      this.busy.set(false);
    }
  }

  async forgotPassword() {
    const email = this.email().trim();
    if (!email) {
      this.errorMsg.set('Enter your email above first, then tap Forgot.');
      return;
    }
    try {
      await this.auth.sendPasswordReset(email);
      this.errorMsg.set(`Reset email sent to ${email}.`);
    } catch (err) {
      this.errorMsg.set(this.friendlyError(err));
    }
  }

  private friendlyError(err: unknown): string {
    if (err instanceof FirebaseError) {
      switch (err.code) {
        case 'auth/invalid-email': return 'That email looks invalid.';
        case 'auth/user-not-found': return 'No account with that email.';
        case 'auth/wrong-password':
        case 'auth/invalid-credential': return 'Wrong email or password.';
        case 'auth/email-already-in-use': return 'An account with that email already exists.';
        case 'auth/weak-password': return 'Password must be at least 6 characters.';
        case 'auth/popup-closed-by-user': return 'Sign-in cancelled.';
        case 'auth/network-request-failed': return 'Network error — check your connection.';
        default: return err.message;
      }
    }
    return 'Something went wrong. Please try again.';
  }
}
