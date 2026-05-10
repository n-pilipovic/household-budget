import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { HouseholdService } from '../data/household.service';

/** Allow the route only when the signed-in user has a household. */
export const householdGuard: CanActivateFn = async () => {
  const households = inject(HouseholdService);
  const router = inject(Router);
  const list = await households.listMyHouseholds();
  if (list.length > 0) return true;
  return router.parseUrl('/onboarding');
};

/** Allow the route only when the signed-in user has NO household. */
export const noHouseholdGuard: CanActivateFn = async () => {
  const households = inject(HouseholdService);
  const router = inject(Router);
  const list = await households.listMyHouseholds();
  if (list.length === 0) return true;
  return router.parseUrl('/today');
};
