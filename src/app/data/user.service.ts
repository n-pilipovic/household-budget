import { Injectable, effect, inject } from '@angular/core';
import { Auth, updateProfile } from '@angular/fire/auth';
import { Firestore, doc, getDoc, serverTimestamp, setDoc, updateDoc } from '@angular/fire/firestore';
import { AuthService } from '../auth/auth.service';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt?: unknown; // serverTimestamp on first write
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly auth = inject(AuthService);
  private readonly firestore = inject(Firestore);
  private readonly fbAuth = inject(Auth);

  constructor() {
    // Whenever a real user resolves, ensure their /users/{uid} doc exists.
    // Idempotent — getDoc first, only write if missing.
    effect(() => {
      const u = this.auth.user();
      if (!u) return;
      this.ensureUserProfile(u.uid, u.email, u.displayName, u.photoURL).catch(err => {
        console.error('ensureUserProfile failed', err);
      });
    });
  }

  /**
   * Update the signed-in user's display name in both Firestore and
   * the Firebase Auth profile. Auth profile update is best-effort —
   * if it fails (e.g. token expired), Firestore is still updated and
   * the rest of the app picks up the new name via memberProfiles.
   */
  async updateDisplayName(name: string): Promise<void> {
    const u = this.auth.user();
    if (!u) throw new Error('Not authenticated');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Display name cannot be empty');

    const ref = doc(this.firestore, 'users', u.uid);
    await updateDoc(ref, { displayName: trimmed });

    const currentUser = this.fbAuth.currentUser;
    if (currentUser) {
      try {
        await updateProfile(currentUser, { displayName: trimmed });
      } catch (err) {
        console.warn('Could not update Auth profile displayName', err);
      }
    }
  }

  async getUserProfile(uid: string): Promise<UserProfile | null> {
    const ref = doc(this.firestore, 'users', uid);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as UserProfile) : null;
  }

  private async ensureUserProfile(
    uid: string,
    email: string | null,
    displayName: string | null,
    photoURL: string | null,
  ): Promise<void> {
    const ref = doc(this.firestore, 'users', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      uid,
      email,
      displayName: displayName ?? this.deriveNameFromEmail(email),
      photoURL,
      createdAt: serverTimestamp(),
    });
  }

  private deriveNameFromEmail(email: string | null): string {
    if (!email) return 'Member';
    const local = email.split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
}
