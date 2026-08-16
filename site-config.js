window.GFD_CONFIG = Object.freeze({
  workspaceId: "gfd-workspace",
  firebase: {
    enabled: false,
    apiKey: "",
    authDomain: "",
    projectId: "gerardo-faustin-app",
    storageBucket: "",
    appId: "",
    recaptchaEnterpriseSiteKey: ""
  },
  functions: {
    region: "us-east1",
    getPublicPricing: "",
    createUploadSession: "",
    submitProjectApplication: ""
  },
  application: {
    maxFiles: 10,
    maxFileBytes: 50 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
    allowedExtensions: ["pdf", "jpg", "jpeg", "png", "docx", "xlsx", "dwg", "dxf", "skp"]
  },
  previewPricing: {
    published: false,
    version: "preview-2026-08",
    baseCurrency: "USD",
    usdToJmd: 156.0,
    rateUpdatedAt: "2026-08-16T00:00:00Z",
    baseRates: { residential: 1.08, commercial: null },
    lowMultiplier: 0.90,
    highMultiplier: 1.10,
    gctRate: 0,
    roomAddOns: {},
    serviceAddOns: {}
  }
});
