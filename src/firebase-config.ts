/* Firebase web config. These values identify the project; they are not
   secrets (Firebase web keys are public by design). Access control lives in
   firestore.rules. */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDnFTCJvPoVwj8sAiQeoDGiYkXr7-4VTHk',
  authDomain: 'team-254-battery-data-tracker.firebaseapp.com',
  projectId: 'team-254-battery-data-tracker',
  storageBucket: 'team-254-battery-data-tracker.firebasestorage.app',
  messagingSenderId: '155991729001',
  appId: '1:155991729001:web:d57455fd6f8d7573acd3f8',
};

/* Accounts that are always admins, even before the members list exists.
   Keep this in sync with bootstrapAdmin() in firestore.rules. */
export const BOOTSTRAP_ADMIN_UIDS = ['sPqQ6DGMrifS4Kr4ohvN1l3UaOE2'];

/* Shared guest login: an Email/Password account made in the Firebase console.
   People type only its password; Firebase checks it on Google's servers, so the
   password is never in this code. The guest is a full admin.
   Keep in sync with guestAdmin() in firestore.rules and storage.rules.
   The .invalid domain can't receive mail, so nobody can reset the password by email. */
export const GUEST_EMAIL = 'guest@battery-bench.invalid';
