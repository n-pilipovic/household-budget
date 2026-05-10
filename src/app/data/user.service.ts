import { Injectable, effect, inject } from '@angular/core';
import { Firestore, doc, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
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
