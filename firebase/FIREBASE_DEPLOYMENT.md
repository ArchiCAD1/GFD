# Firebase deployment prerequisites

1. Add the production `GoogleService-Info.plist` to the app target using the Firebase project that owns Firestore.
2. Use a trusted Admin SDK environment to set these custom claims for each approved Firebase user:

   ```json
   { "workspace_id": "gfd-workspace", "workspace_role": "admin" }
   ```

   `workspace_role` may be `admin`, `editor`, or `reviewer`. Claims must be refreshed by signing out and back in after they are changed.
3. Configure Firebase Authentication email-link sign-in. Add the production GitHub Pages hostname as an authorized HTTPS domain.
4. Create a reCAPTCHA Enterprise site key and register the website with Firebase App Check. Put only the public site key in the portfolio `site-config.js`; never store credentials in either repository.
5. Create an APNs authentication key in the Apple Developer portal, upload it under Firebase Cloud Messaging, and enable Push Notifications for the app identifier.
6. Seed `workspaces/gfd-workspace/publicPricing/current`. The initial residential rate is USD 1.28/sq. ft. Keep `published=false` until commercial rates, add-on tables, range multipliers, GCT, currencies, and exchange-rate date are complete.
7. Set `ALLOWED_ORIGINS` for Functions to the exact production GitHub Pages origin. Localhost origins are included only for emulator development.
8. From the `web` directory, install, test, then deploy:

   ```sh
   cd functions && npm ci && npm test && cd ..
   firebase deploy --only firestore:rules,firestore:indexes,storage,functions
   ```

The rules are deny-by-default. Do not deploy them until the owner account has been provisioned with an `admin` claim, or cloud access will correctly be denied.

## Gmail delivery setup

`submitProjectApplication` generates the preliminary-estimate PDF and writes separate applicant and owner records to the `outboundEmail` queue. `sendQueuedEstimateEmail` delivers both through Gmail SMTP. Configure these Google Secret Manager values before deployment:

```sh
firebase functions:secrets:set GFD_SMTP_USER
firebase functions:secrets:set GFD_SMTP_APP_PASSWORD
```

Use `gerardofaustindesigns@gmail.com` for `GFD_SMTP_USER` and a Google Account app password for `GFD_SMTP_APP_PASSWORD`. Never use the normal account password and never add either value to source control. The owner notification recipient is `gerardofaustindesigns@gmail.com`.

## Required production checks

- Verify Auth, App Check, strict CORS, throttling, Firestore and Storage rules in the Firebase Emulator Suite.
- Confirm the GitHub Pages domain, Firebase Storage bucket, function URLs, and public Firebase configuration in `site-config.js`.
- Test APNs/FCM on a physical device. Simulator success is not sufficient for release approval.
- Publish pricing from the companion app only after `isPublishable` is true.
- Keep the portfolio unpublished until its destination Git remote is supplied.

## Backend endpoints

Any endpoint configured through `BackendBaseURL` must validate the Firebase ID token supplied in the `Authorization: Bearer <token>` header. Validate its signature, issuer, audience, expiry, and the `workspace_id` / `workspace_role` claims before reading or changing workspace data. The app no longer sends a bundled API key or `x-api-key` header.
