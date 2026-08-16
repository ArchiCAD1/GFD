# Gerardo Faustin Design

An original interactive portfolio application for Gerardo Faustin Design. It is built in plain HTML, CSS, JavaScript, and Three.js, with no package manager or compilation step.

The experience includes a live procedural Caribbean residence, six scroll-controlled camera positions, direct drag-to-orbit exploration with double-click reset, atmospheric particles, animated interior and path lighting, a reflecting pool, coastal landscaping, editorial chapter layouts, and original generated architectural project imagery. A lightweight Canvas scene remains available as a fallback if WebGL cannot load.

## Run locally

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:4173`.

## Publish with GitHub Pages

1. Create a GitHub repository owned by Gerardo Faustin Design.
2. Commit this folder's contents to its `main` branch.
3. In **Settings → Pages**, choose **Deploy from a branch**, then `main` and `/ (root)`.

The site has no build configuration: GitHub Pages can serve it directly. Three.js r149 is loaded from jsDelivr at runtime.

## Asset credit

The architectural images in `assets/` are original AI-generated project imagery created for this site.
