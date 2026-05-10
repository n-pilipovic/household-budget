import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Auth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  user as firebaseUser,
} from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);

  /**
   * Auth state, three values:
   *   undefined → still resolving on app boot
   *   null      → resolved, no user signed in
   *   User      → resolved, signed in
   */
  readonly user = toSignal(firebaseUser(this.auth), { initialValue: undefined });
  readonly isLoading = computed(() => this.user() === undefined);
  readonly isAuthenticated = computed(() => !!this.user());

  signInWithGoogle() {
    return signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  signInWithEmail(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  createWithEmail(email: string, password: string) {
    return createUserWithEmailAndPassword(this.auth, email, password);
  }

  sendPasswordReset(email: string) {
    return sendPasswordResetEmail(this.auth, email);
  }

  signOut() {
    return signOut(this.auth);
  }
}
