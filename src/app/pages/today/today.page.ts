import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-today',
  imports: [],
  templateUrl: './today.page.html',
})
export class TodayPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
