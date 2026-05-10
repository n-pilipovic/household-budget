import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UserService } from './data/user.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor() {
    // Eagerly instantiate UserService so its effect runs from app boot:
    // ensures /users/{uid} exists on every sign-in.
    inject(UserService);
  }
}
