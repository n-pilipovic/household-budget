import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { HouseholdService } from '../../data/household.service';

@Component({
  selector: 'app-today',
  imports: [],
  templateUrl: './today.page.html',
})
export class TodayPage {
  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly household = this.households.currentHousehold;

  protected readonly myColor = computed(() => {
    const u = this.user();
    const h = this.household();
    if (!u || !h) return 'novica';
    return h.memberColors?.[u.uid] ?? 'novica';
  });

  protected readonly memberCount = computed(() => this.household()?.members.length ?? 0);

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
