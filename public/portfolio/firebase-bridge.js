const SDK_VERSION = "10.14.1";
let app;
let auth;
let storage;
let authModule;
let storageModule;
let appCheckModule;
let appCheck;

export async function initializeFirebase(config) {
  if (!config?.enabled || !config.apiKey || !config.authDomain || !config.appId) return null;
  const [{ initializeApp }, authSdk, storageSdk, appCheckSdk] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-storage.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-check.js`)
  ]);
  authModule = authSdk;
  storageModule = storageSdk;
  appCheckModule = appCheckSdk;
  app = initializeApp(config);
  auth = authSdk.getAuth(app);
  storage = storageSdk.getStorage(app);
  if (config.recaptchaEnterpriseSiteKey) {
    appCheck = appCheckSdk.initializeAppCheck(app, {
      provider: new appCheckSdk.ReCaptchaEnterpriseProvider(config.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  }
  return { app, auth, storage };
}

export function isConfigured() {
  return Boolean(auth && storage);
}

export async function sendVerificationLink(email) {
  if (!auth || !authModule) throw new Error("Firebase email verification is not configured.");
  const actionCodeSettings = {
    url: `${location.origin}${location.pathname}`,
    handleCodeInApp: true
  };
  await authModule.sendSignInLinkToEmail(auth, email, actionCodeSettings);
  localStorage.setItem("gfdEmailForSignIn", email);
}

export async function completeEmailLinkIfPresent() {
  if (!auth || !authModule || !authModule.isSignInWithEmailLink(auth, location.href)) return auth?.currentUser ?? null;
  const email = localStorage.getItem("gfdEmailForSignIn") || window.prompt("Confirm the email address that received this secure link:");
  if (!email) throw new Error("The verification email is required to complete sign-in.");
  const result = await authModule.signInWithEmailLink(auth, email, location.href);
  localStorage.removeItem("gfdEmailForSignIn");
  history.replaceState({}, document.title, location.pathname);
  return result.user;
}

export function currentUser() {
  return auth?.currentUser ?? null;
}

export async function idToken() {
  if (!auth?.currentUser) throw new Error("Verify your email before submitting.");
  return auth.currentUser.getIdToken();
}

export async function appCheckToken() {
  if (!appCheck || !appCheckModule) return "";
  return (await appCheckModule.getToken(appCheck, false)).token;
}

export async function uploadIntakeFile({ uid, applicationId, attachmentId, file, sha256 }) {
  if (!storage || !storageModule) throw new Error("Secure uploads are not configured.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
  const path = `intakeUploads/${uid}/${applicationId}/${attachmentId}-${safeName}`;
  const object = storageModule.ref(storage, path);
  await storageModule.uploadBytes(object, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: { sha256, originalName: safeName, applicationId }
  });
  return { id: attachmentId, path, name: safeName, size: file.size, type: file.type || "application/octet-stream", sha256 };
}

export async function downloadEstimateFile(path) {
  if (!storage || !storageModule || !path) throw new Error("The secure estimate is not available yet.");
  const url = await storageModule.getDownloadURL(storageModule.ref(storage, path));
  const link = document.createElement("a");
  link.href = url;
  link.download = path.split("/").pop() || "GFD-preliminary-estimate.pdf";
  link.rel = "noopener";
  link.click();
}
