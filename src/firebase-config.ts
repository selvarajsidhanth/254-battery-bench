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
