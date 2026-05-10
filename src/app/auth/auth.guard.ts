import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { firstValueFrom, take } from 'rxjs';

/**
 * Allows the route only when a user is signed in.
 * Resolves the auth state once on entry; the @angular/fire `user()`
 * observable always emits the current state on subscribe (User or null),
 * so a single take(1) is correct.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const u = await firstValueFrom(user(auth).pipe(take(1)));
  if (u) return true;
  return router.parseUrl('/sign-in');
};

/**
 * Inverse of authGuard. Used on /sign-in so a signed-in user
 * who navigates back to it bounces forward to /today.
 */
export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const u = await firstValueFrom(user(auth).pipe(take(1)));
  if (!u) return true;
  return router.parseUrl('/today');
};
