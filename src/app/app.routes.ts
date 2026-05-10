import { Routes } from '@angular/router';
import { authGuard, signedOutGuard } from './auth/auth.guard';
import { householdGuard, noHouseholdGuard } from './auth/household.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'today',
  },
  {
    path: 'sign-in',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./pages/sign-in/sign-in.page').then(m => m.SignInPage),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard, noHouseholdGuard],
    loadComponent: () => import('./pages/onboarding/onboarding.page').then(m => m.OnboardingPage),
  },
  {
    path: 'today',
    canActivate: [authGuard, householdGuard],
    loadComponent: () => import('./pages/today/today.page').then(m => m.TodayPage),
  },
  {
    path: '**',
    redirectTo: 'today',
  },
];
