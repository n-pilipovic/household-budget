import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, GoogleAuthProvider, signInWithPopup, signOut, user } from '@angular/fire/auth';
import { LucideAngularModule, LogIn, LogOut, Check } from 'lucide-angular';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LucideAngularModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly auth = inject(Auth);
  protected readonly user = toSignal(user(this.auth), { initialValue: undefined });

  protected readonly LogIn = LogIn;
  protected readonly LogOut = LogOut;
  protected readonly Check = Check;

  protected async signInWithGoogle() {
    try {
      await signInWithPopup(this.auth, new GoogleAuthProvider());
    } catch (err) {
      console.error('Google sign-in failed', err);
    }
  }

  protected async signOutNow() {
    await signOut(this.auth);
  }
}
