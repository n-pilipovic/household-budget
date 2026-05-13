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
    // Existing-user variant: same component, no no-household guard, so
    // a user already in 1+ households can add another (create or join).
    path: 'households/add',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/onboarding/onboarding.page').then(m => m.OnboardingPage),
  },
  {
    path: 'today',
    canActivate: [authGuard, householdGuard],
    loadComponent: () => import('./pages/today/today.page').then(m => m.TodayPage),
  },
  {
    path: 'monthly',
    canActivate: [authGuard, householdGuard],
    loadComponent: () => import('./pages/monthly/monthly.page').then(m => m.MonthlyPage),
  },
  {
    path: 'yearly',
    canActivate: [authGuard, householdGuard],
    loadComponent: () => import('./pages/yearly/yearly.page').then(m => m.YearlyPage),
  },
  {
    path: 'category/:id',
    canActivate: [authGuard, householdGuard],
    loadComponent: () => import('./pages/category-detail/category-detail.page').then(m => m.CategoryDetailPage),
  },
  {
    path: 'settings',
    canActivate: [authGuard, householdGuard],
    loadComponent: () => import('./pages/settings/settings.page').then(m => m.SettingsPage),
  },
  {
    path: '**',
    redirectTo: 'today',
  },
];
