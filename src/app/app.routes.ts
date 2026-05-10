import { Routes } from '@angular/router';
import { authGuard, signedOutGuard } from './auth/auth.guard';

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
    path: 'today',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/today/today.page').then(m => m.TodayPage),
  },
  {
    path: '**',
    redirectTo: 'today',
  },
];
