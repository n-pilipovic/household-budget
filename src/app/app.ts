import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UserService } from './data/user.service';
import { UpdateService } from './data/update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Eagerly instantiate so its effect (ensure /users/{uid} doc on
  // sign-in) runs from app boot, regardless of whether other code
  // injects it.
  private readonly userService = inject(UserService);
  protected readonly updates = inject(UpdateService);

  constructor() {
    void this.userService;
  }
}
