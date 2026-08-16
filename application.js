import {
  appCheckToken,
  completeEmailLinkIfPresent,
  currentUser,
  idToken,
  initializeFirebase,
  isConfigured as firebaseIsConfigured,
  sendVerificationLink,
  uploadIntakeFile
} from "./firebase-bridge.js";
import { createPreliminaryEstimatePDF } from "./preliminary-pdf.js";

const config = window.GFD_CONFIG;
const form = document.querySelector("#project-application");
const steps = [...document.querySelectorAll(".wizard-step")];
const previousButton = document.querySelector("#previous-step");
const nextButton = document.querySelector("#next-step");
const progressBar = document.querySelector("#progress-bar");
const progressName = document.querySelector("#progress-name");
const progressCount = document.querySelector("#progress-count");
const formError = document.querySelector("#form-error");
const verificationStatus = document.querySelector("#verification-status");
const verifyButton = document.querySelector("#verify-email");
const documentInput = document.querySelector("#documents");
const fileList = document.querySelector("#file-list");
const reviewSummary = document.querySelector("#review-summary");
const wizardContent = document.querySelector("#wizard-content");
const successPanel = document.querySelector("#success-panel");
const downloadButton = document.querySelector("#download-estimate");
const residentialRooms = document.querySelector(".residential-rooms");
const commercialRooms = document.querySelector(".commercial-rooms");

let currentStep = 0;
let emailVerified = false;
let selectedFiles = [];
let pricing = config.previewPricing;
let latestEstimate = null;
let latestPayload = null;
let latestReference = null;
let firebaseReady = false;

const money = (amount, currency) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency,
  maximumFractionDigits: 2
}).format(Number.isFinite(amount) ? amount : 0);

const value = name => new FormData(form).get(name)?.toString().trim() ?? "";
const numberValue = name => Number(value(name) || 0);
const checkedValues = name => [...form.querySelectorAll(`[name="${name}"]:checked`)].map(input => input.value);
const classification = () => value("classification") || "residential";
const currency = () => value("currency") || "USD";

function showError(message = "") {
  formError.textContent = message;
}

function setStep(index) {
  currentStep = Math.max(0, Math.min(steps.length - 1, index));
  steps.forEach((step, stepIndex) => step.classList.toggle("is-active", stepIndex === currentStep));
  previousButton.disabled = currentStep === 0;
  nextButton.textContent = currentStep === steps.length - 1 ? "Submit application" : "Continue";
  progressBar.style.setProperty("--progress", `${((currentStep + 1) / steps.length) * 100}%`);
  progressName.textContent = steps[currentStep].dataset.title;
  progressCount.textContent = `${String(currentStep + 1).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")}`;
  showError();
  if (currentStep === steps.length - 1) renderReview();
  form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function validateStep(index) {
  const required = [...steps[index].querySelectorAll("[required]")];
  for (const field of required) {
    if (field.type === "radio") {
      if (!form.querySelector(`[name="${field.name}"]:checked`)) {
        showError("Choose an option before continuing.");
        return false;
      }
    } else if (field.type === "checkbox") {
      if (!field.checked) {
        field.focus();
        showError("Please review and accept each required statement.");
        return false;
      }
    } else if (!field.checkValidity()) {
      field.reportValidity();
      showError("Complete the highlighted field before continuing.");
      return false;
    }
  }
  if (index === 0 && !emailVerified) {
    showError(firebaseReady ? "Verify your email using the secure link before continuing." : "Use Preview verification to continue in this local build.");
    return false;
  }
  return true;
}

function rooms() {
  if (classification() === "commercial") {
    return {
      offices: numberValue("offices"), commercialUnits: numberValue("commercialUnits"),
      washrooms: numberValue("washrooms"), meetingRooms: numberValue("meetingRooms"),
      publicAreas: numberValue("publicAreas"), otherCommercial: numberValue("otherCommercial")
    };
  }
  return {
    bedrooms: numberValue("bedrooms"), bathrooms: numberValue("bathrooms"),
    kitchens: numberValue("kitchens"), livingRooms: numberValue("livingRooms"),
    diningRooms: numberValue("diningRooms"), otherRooms: numberValue("otherRooms")
  };
}

function calculateEstimate() {
  const projectClass = classification();
  const area = numberValue("squareFeet");
  const baseRate = pricing.baseRates?.[projectClass];
  const conversion = currency() === "JMD" ? Number(pricing.usdToJmd || 0) : 1;
  let additionsUSD = 0;
  const detail = [];
  Object.entries(rooms()).forEach(([key, count]) => {
    const rate = Number(pricing.roomRates?.[key] ?? pricing.roomAddOns?.[projectClass]?.[key] ?? 0);
    if (count > 0 && rate > 0) {
      additionsUSD += count * rate;
      detail.push({ label: key, quantity: count, rate });
    }
  });
  checkedValues("services").forEach(service => {
    const rate = Number(pricing.serviceRates?.[service] ?? pricing.serviceAddOns?.[projectClass]?.[service] ?? 0);
    if (rate > 0) {
      additionsUSD += rate;
      detail.push({ label: service, quantity: 1, rate });
    }
  });
  const complete = Number.isFinite(baseRate) && baseRate > 0 && area >= 100 && conversion > 0;
  if (!complete) return { complete: false, projectClass, area, baseRate, detail };
  const baseUSD = area * baseRate;
  const subtotalBeforeTaxUSD = baseUSD + additionsUSD;
  const gctPercent = pricing.includeGCT ? Number(pricing.gctPercent ?? pricing.gctRate ?? 0) : 0;
  const subtotalUSD = subtotalBeforeTaxUSD * (1 + gctPercent / 100);
  const lowUSD = subtotalUSD * Number(pricing.lowMultiplier || 1);
  const highUSD = subtotalUSD * Number(pricing.highMultiplier || 1);
  return {
    complete: true, projectClass, area, baseRate, detail, conversion,
    base: baseUSD * conversion,
    additions: additionsUSD * conversion,
    low: lowUSD * conversion,
    high: highUSD * conversion,
    subtotalUSD,
    currency: currency(),
    pricingVersion: pricing.version,
    rateUpdatedAt: pricing.exchangeRateAsOf ?? pricing.rateUpdatedAt
  };
}

function updateEstimate() {
  latestEstimate = calculateEstimate();
  const projectTitle = latestEstimate.projectClass === "commercial" ? "Commercial project" : "Residential project";
  document.querySelector("#estimate-title").textContent = projectTitle;
  document.querySelector("#estimate-rate").textContent = Number.isFinite(latestEstimate.baseRate)
    ? `USD ${latestEstimate.baseRate.toFixed(2)} / sq. ft.` : "Rate pending configuration";
  if (!latestEstimate.complete) {
    document.querySelector("#estimate-base").textContent = latestEstimate.area ? "Rate not published" : "Enter square footage";
    document.querySelector("#estimate-addons").textContent = "Pending configuration";
    document.querySelector("#estimate-range").textContent = "Not calculated";
    return;
  }
  document.querySelector("#estimate-base").textContent = money(latestEstimate.base, latestEstimate.currency);
  document.querySelector("#estimate-addons").textContent = latestEstimate.additions ? money(latestEstimate.additions, latestEstimate.currency) : "No priced add-ons";
  document.querySelector("#estimate-range").textContent = `${money(latestEstimate.low, latestEstimate.currency)} – ${money(latestEstimate.high, latestEstimate.currency)}`;
}

function toggleRoomProgramme() {
  const commercial = classification() === "commercial";
  residentialRooms.hidden = commercial;
  commercialRooms.hidden = !commercial;
  updateEstimate();
}

async function sha256(file) {
  const data = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function validateFiles(files) {
  const allowed = new Set(config.application.allowedExtensions);
  const maxFiles = config.application.maxFiles;
  const maxFileBytes = config.application.maxFileBytes;
  const maxTotalBytes = config.application.maxTotalBytes;
  if (files.length > maxFiles) throw new Error(`Choose no more than ${maxFiles} files.`);
  let total = 0;
  files.forEach(file => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowed.has(extension)) throw new Error(`${file.name} is not an allowed file type.`);
    if (file.size > maxFileBytes) throw new Error(`${file.name} is larger than 50 MB.`);
    total += file.size;
  });
  if (total > maxTotalBytes) throw new Error("The selected files exceed the 200 MB total limit.");
}

function renderFiles() {
  fileList.innerHTML = selectedFiles.map(file => `<div class="file-item"><span>${escapeHTML(file.name)}</span><span>${(file.size / 1024 / 1024).toFixed(1)} MB</span></div>`).join("");
}

function escapeHTML(text) {
  return String(text).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function collectPayload() {
  const estimate = calculateEstimate();
  return {
    schemaVersion: 1,
    contact: {
      name: value("fullName"), company: value("company"), email: value("email"),
      phone: value("phone"), preferredContact: value("preferredContact")
    },
    project: {
      classification: classification(), projectType: value("projectType"), stage: value("projectStage"),
      siteAddress: value("siteAddress"), parish: value("parish"), buildStatus: value("buildStatus"),
      squareFeet: numberValue("squareFeet"), floors: numberValue("floors"), rooms: rooms(),
      services: checkedValues("services"), currency: currency(), budgetRange: value("budget"),
      desiredStart: value("desiredStart"), targetCompletion: value("targetCompletion"), scope: value("scope"), notes: value("notes")
    },
    consent: {
      privacy: Boolean(form.elements.privacyConsent?.checked),
      disclaimer: Boolean(form.elements.estimateConsent?.checked),
      contact: Boolean(form.elements.contactConsent?.checked)
    },
    clientEstimate: estimate.complete ? estimate : null,
    source: location.href
  };
}

function renderReview() {
  latestPayload = collectPayload();
  const roomText = Object.entries(latestPayload.project.rooms).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`).join(", ") || "No room counts supplied";
  const serviceText = latestPayload.project.services.length ? latestPayload.project.services.join(", ") : "No services selected";
  const estimateText = latestPayload.clientEstimate
    ? `${money(latestPayload.clientEstimate.low, currency())} – ${money(latestPayload.clientEstimate.high, currency())}`
    : "Pricing configuration is incomplete; this application will require manual pricing.";
  reviewSummary.innerHTML = `
    <div class="review-section"><h3>Applicant</h3><p>${escapeHTML(latestPayload.contact.name)} · ${escapeHTML(latestPayload.contact.email)} · ${escapeHTML(latestPayload.contact.phone)}</p></div>
    <div class="review-section"><h3>Project</h3><p>${escapeHTML(latestPayload.project.classification)} ${escapeHTML(latestPayload.project.projectType)} · ${latestPayload.project.squareFeet.toLocaleString()} sq. ft. · ${latestPayload.project.floors} floor(s)<br>${escapeHTML(latestPayload.project.siteAddress)}</p></div>
    <div class="review-section"><h3>Spaces and services</h3><p>${escapeHTML(roomText)}<br>${escapeHTML(serviceText)}</p></div>
    <div class="review-section"><h3>Preliminary range</h3><p>${escapeHTML(estimateText)}</p></div>`;
}

async function verifyEmail() {
  const emailField = form.elements.email;
  if (!emailField.checkValidity()) { emailField.reportValidity(); return; }
  verifyButton.disabled = true;
  try {
    if (!firebaseReady) {
      emailVerified = true;
      verificationStatus.textContent = "Preview verification active. Production will require the secure Firebase email link.";
      verifyButton.textContent = "Verified for preview";
      return;
    }
    const user = currentUser();
    if (user?.email?.toLowerCase() === emailField.value.trim().toLowerCase()) {
      emailVerified = true;
      verificationStatus.textContent = `Verified as ${user.email}.`;
      verifyButton.textContent = "Verified";
      return;
    }
    await sendVerificationLink(emailField.value.trim());
    verificationStatus.textContent = "A secure sign-in link was sent. Open it on this device to continue.";
    verifyButton.textContent = "Link sent";
  } catch (error) {
    showError(error.message || "Email verification could not be started.");
    verifyButton.disabled = false;
  }
}

async function uploadDocuments(applicationId) {
  if (!selectedFiles.length) return [];
  if (!firebaseReady || !currentUser()) return Promise.all(selectedFiles.map(async (file, index) => ({
    id: crypto.randomUUID(),
    path: `preview/${applicationId}/${index}-${file.name}`,
    name: file.name, size: file.size, type: file.type, sha256: await sha256(file), previewOnly: true
  })));
  const uid = currentUser().uid;
  const results = [];
  for (let index = 0; index < selectedFiles.length; index += 1) {
    const file = selectedFiles[index];
    const checksum = await sha256(file);
    results.push(await uploadIntakeFile({ uid, applicationId, attachmentId: crypto.randomUUID(), file, sha256: checksum }));
  }
  return results;
}

async function submitApplication() {
  latestPayload = collectPayload();
  let localApplicationId = crypto.randomUUID();
  nextButton.disabled = true;
  nextButton.textContent = "Preparing…";
  try {
    if (firebaseReady && config.functions.createUploadSession) {
      const token = await idToken();
      const check = await appCheckToken();
      const sessionResponse = await fetch(config.functions.createUploadSession, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(check ? { "X-Firebase-AppCheck": check } : {}) }
      });
      const session = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(session.error || "A secure upload session could not be created.");
      localApplicationId = session.applicationId;
    }
    const attachments = await uploadDocuments(localApplicationId);
    latestPayload.applicationId = localApplicationId;
    latestPayload.attachments = attachments;
    if (firebaseReady && config.functions.submitProjectApplication) {
      const token = await idToken();
      const check = await appCheckToken();
      const response = await fetch(config.functions.submitProjectApplication, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": localApplicationId, ...(check ? { "X-Firebase-AppCheck": check } : {}) },
        body: JSON.stringify(latestPayload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The application could not be submitted.");
      latestReference = result.reference;
      latestEstimate = result.estimate || latestEstimate;
      if (result.estimate) {
        latestPayload.clientEstimate = {
          complete: true,
          base: result.estimate.base,
          additions: result.estimate.addOns,
          low: result.estimate.low,
          high: result.estimate.high,
          currency: result.estimate.displayCurrency
        };
      }
    } else {
      latestReference = `PREVIEW-${new Date().getFullYear()}-${localApplicationId.slice(0, 8).toUpperCase()}`;
      localStorage.setItem(`gfdApplication:${latestReference}`, JSON.stringify(latestPayload));
    }
    wizardContent.hidden = true;
    successPanel.classList.add("is-visible");
    document.querySelector("#success-copy").textContent = firebaseReady
      ? `Reference ${latestReference}. Your preliminary estimate is being prepared and the GFD application inbox has been notified.`
      : `Reference ${latestReference}. This local preview saved the application on this device; cloud delivery activates when Firebase is configured.`;
    successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showError(error.message || "The application could not be submitted.");
    nextButton.disabled = false;
    nextButton.textContent = "Submit application";
  }
}

async function loadPricing() {
  if (!config.functions.getPublicPricing) return;
  try {
    const check = await appCheckToken();
    const response = await fetch(config.functions.getPublicPricing, { headers: { Accept: "application/json", ...(check ? { "X-Firebase-AppCheck": check } : {}) } });
    const result = await response.json();
    if (!response.ok || !result?.version) throw new Error("Pricing is unavailable.");
    pricing = result;
    document.querySelector("#configuration-badge").textContent = pricing.published ? `Published rates · ${pricing.version}` : "Pricing not published";
  } catch {
    document.querySelector("#configuration-badge").textContent = "Configuration preview · connection unavailable";
  }
  updateEstimate();
}

async function generateEstimatePDF() {
  if (!latestPayload) latestPayload = collectPayload();
  const blob = createPreliminaryEstimatePDF({ reference: latestReference, payload: latestPayload, estimate: latestPayload.clientEstimate, money });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `${latestReference || "GFD-preliminary-estimate"}.pdf`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

previousButton.addEventListener("click", () => setStep(currentStep - 1));
nextButton.addEventListener("click", async () => {
  if (!validateStep(currentStep)) return;
  if (currentStep < steps.length - 1) setStep(currentStep + 1);
  else await submitApplication();
});
verifyButton.addEventListener("click", verifyEmail);
downloadButton.addEventListener("click", generateEstimatePDF);
documentInput.addEventListener("change", event => {
  try { selectedFiles = [...event.target.files]; validateFiles(selectedFiles); renderFiles(); showError(); }
  catch (error) { selectedFiles = []; documentInput.value = ""; renderFiles(); showError(error.message); }
});
form.addEventListener("input", event => {
  if (event.target.name === "classification") toggleRoomProgramme();
  updateEstimate();
});

async function boot() {
  try {
    const firebase = await initializeFirebase(config.firebase);
    firebaseReady = Boolean(firebase && firebaseIsConfigured());
    if (firebaseReady) {
      const user = await completeEmailLinkIfPresent();
      if (user?.email) {
        form.elements.email.value = user.email;
        emailVerified = true;
        verificationStatus.textContent = `Verified as ${user.email}.`;
        verifyButton.textContent = "Verified";
        verifyButton.disabled = true;
      }
    } else {
      verifyButton.textContent = "Preview verification";
    }
  } catch (error) {
    verificationStatus.textContent = error.message || "Email verification could not be completed.";
  }
  await loadPricing();
  toggleRoomProgramme();
  updateEstimate();
}

boot();
