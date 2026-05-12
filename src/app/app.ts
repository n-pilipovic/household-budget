import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './data/theme.service';
import { UserService } from './data/user.service';
import { UpdateService } from './data/update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Eagerly instantiate so their effects run from app boot:
  //  - UserService ensures /users/{uid} doc on sign-in
  //  - ThemeService applies the saved theme (System/Light/Dark) to <html>
  //    before the first paint of any route
  private readonly userService = inject(UserService);
  private readonly themeService = inject(ThemeService);
  protected readonly updates = inject(UpdateService);

  constructor() {
    void this.userService;
    void this.themeService;
  }
}
