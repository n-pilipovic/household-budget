/**
 * Firebase web SDK config — public-by-design.
 * These keys identify the project to the API; they do NOT authenticate
 * or grant access. Real security lives in:
 *   - Firestore rules (see firestore.rules in the project root once added)
 *   - Auth provider configuration (Authorized domains in Firebase console)
 *   - App Check (optional, can add later)
 *
 * The same project is used for local dev and production for now. If we
 * split later, add environment.development.ts + configure fileReplacements
 * in angular.json.
 */
export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyBXl4G-3fPzu1sMvU3Ze94HiCjZVbZA0a0',
    authDomain: 'household-budget-bccb2.firebaseapp.com',
    projectId: 'household-budget-bccb2',
    storageBucket: 'household-budget-bccb2.firebasestorage.app',
    messagingSenderId: '867119256319',
    appId: '1:867119256319:web:a75dd877066e87d1f8f2ca',
    measurementId: 'G-VB3PCRKTDV',
  },
} as const;
