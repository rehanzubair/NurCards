import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Load Firebase Config
  const configPath = path.resolve(__dirname, "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // Initialize Firebase
  const firebaseApp = initializeApp(firebaseConfig);
  const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

  // 1. Ultra-Compatible Share Endpoint
  // Using a short /s/ path and multiple redirect/bypass techniques
  app.get("/s/:cardId", async (req, res) => {
    const cardId = req.params.cardId;
    
    let title = "Nur Flashcards";
    let description = "Wisdom in every card. Explore and share flashcards.";
    let imageUrl = "https://picsum.photos/seed/wisdom/1200/630.jpg";
    
    const forwardedHost = req.get("x-forwarded-host");
    const host = forwardedHost || req.get("host") || "";
    const proto = req.get("x-forwarded-proto") || "https";
    let publicUrl = `${proto}://${host}`;
    if (publicUrl.includes("-dev-")) publicUrl = publicUrl.replace("-dev-", "-pre-");
    if (publicUrl.startsWith("http://")) publicUrl = publicUrl.replace("http://", "https://");
    const cleanPublicUrl = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
    const currentUrl = cleanPublicUrl + "/?card=" + cardId;

    if (cardId) {
      try {
        const cardDoc = await getDoc(doc(db, "flashcards", cardId));
        if (cardDoc.exists()) {
          const card = cardDoc.data();
          title = card.title || title;
          description = card.description || card.topic || description;
          imageUrl = `${cleanPublicUrl}/api/card-image/${cardId}.png`;
        }
      } catch (err) {
        console.error("[Share] Error fetching card:", err);
      }
    }

    const minimalHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${description}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:image" content="${imageUrl}"><meta property="og:image:secure_url" content="${imageUrl}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${currentUrl}"><meta property="og:type" content="article"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=${currentUrl}"></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h1>${title}</h1><p>${description}</p><p><a href="${currentUrl}">Click here if not redirected</a></p></body></html>`;

    // Set a dummy cookie to potentially bypass simple bot filters that check for cookie support
    res.cookie('visid_incap_bypass', '1', { maxAge: 900000, httpOnly: true });
    
    return res.status(200).set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Frame-Options": "ALLOWALL",
      "Access-Control-Allow-Origin": "*",
      "Refresh": `0; url=${currentUrl}`,
      "Vary": "User-Agent, Accept"
    }).send(minimalHtml);
  });

  // Ultra-Compatible Board Share Endpoint
  app.get("/sb/:boardId", async (req, res) => {
    const boardId = req.params.boardId;
    
    let title = "Nur Flashcards Board";
    let description = "Explore this collection of wisdom flashcards.";
    let imageUrl = "https://picsum.photos/seed/wisdom/1200/630.jpg";
    
    const forwardedHost = req.get("x-forwarded-host");
    const host = forwardedHost || req.get("host") || "";
    const proto = req.get("x-forwarded-proto") || "https";
    let publicUrl = `${proto}://${host}`;
    if (publicUrl.includes("-dev-")) publicUrl = publicUrl.replace("-dev-", "-pre-");
    if (publicUrl.startsWith("http://")) publicUrl = publicUrl.replace("http://", "https://");
    const cleanPublicUrl = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
    const currentUrl = cleanPublicUrl + "/?view=board&board=" + boardId;

    const minimalHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:image" content="${imageUrl}"><meta property="og:url" content="${currentUrl}"><meta property="og:type" content="article"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=${currentUrl}"></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h1>${title}</h1><p><a href="${currentUrl}">Click here if not redirected</a></p></body></html>`;

    res.cookie('visid_incap_bypass', '1', { maxAge: 900000, httpOnly: true });

    return res.status(200).set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Frame-Options": "ALLOWALL",
      "Access-Control-Allow-Origin": "*",
      "Refresh": `0; url=${currentUrl}`,
      "Vary": "User-Agent, Accept"
    }).send(minimalHtml);
  });

  // 2. Security headers
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });

  console.log("[OG Debug] Environment Variables (Keys):", Object.keys(process.env).filter(k => k.includes("URL") || k.includes("HOST")));
  console.log("[OG Debug] APP_URL:", process.env.APP_URL);

  let vite: any;
  if (process.env.NODE_ENV !== "production") {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
  }

  // Image Proxy Route with file extension for better crawler compatibility
  app.get("/api/card-image/:cardId.png", async (req, res) => {
    const cardId = req.params.cardId;
    if (!cardId) return res.status(400).send("Missing card ID");

    try {
      const cardDoc = await getDoc(doc(db, "flashcards", cardId));
      if (!cardDoc.exists()) return res.status(404).send("Card not found");

      const card = cardDoc.data();
      let imageUrl = card.imageUrl;

      if (!imageUrl) {
        imageUrl = "https://picsum.photos/seed/wisdom/1200/630";
      }

      if (imageUrl.startsWith("data:image/")) {
        const matches = imageUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          return res.status(400).send("Invalid base64 image");
        }
        const contentType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        res.set("Content-Type", contentType);
        res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
        return res.send(buffer);
      } else {
        // Fetch and serve the image directly to avoid redirect issues with social crawlers
        try {
          const response = await fetch(imageUrl);
          if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
          const arrayBuffer = await response.arrayBuffer();
          const contentType = response.headers.get("content-type") || "image/jpeg";
          res.set("Content-Type", contentType);
          res.set("Cache-Control", "public, max-age=86400");
          return res.send(Buffer.from(arrayBuffer));
        } catch (e) {
          console.error("Error fetching remote image, falling back to redirect:", e);
          res.set("Cache-Control", "public, max-age=3600");
          return res.redirect(imageUrl);
        }
      }
    } catch (err) {
      console.error("Error serving card image:", err);
      res.status(500).send("Internal server error");
    }
  });

  // Legacy route for compatibility
  app.get("/api/card-image", (req, res) => {
    const cardId = req.query.card as string;
    if (cardId) return res.redirect(`/api/card-image/${cardId}.png`);
    res.status(400).send("Missing card ID");
  });

  // robots.txt for crawlers
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    res.send("User-agent: *\nAllow: /");
  });

  app.get("*", async (req, res, next) => {
    const url = req.originalUrl;
    const cardId = req.query.card as string;

    // Skip for static assets and internal vite requests
    if (url.includes(".") || url.startsWith("/@") || url.startsWith("/node_modules") || url.startsWith("/api/")) {
      return next();
    }

    try {
      let title = "Nur Flashcards";
      let description = "Wisdom in every card. Explore and share flashcards.";
      let imageUrl = "https://picsum.photos/seed/wisdom/1200/630.jpg";
      
      // Robust public URL construction
      const forwardedHost = req.get("x-forwarded-host");
      const host = forwardedHost || req.get("host") || "";
      const proto = req.get("x-forwarded-proto") || "https";
      
      let publicUrl = `${proto}://${host}`;
      
      // If we are on the dev domain, try to point to the pre (shared) domain for sharing
      if (publicUrl.includes("-dev-")) {
        publicUrl = publicUrl.replace("-dev-", "-pre-");
      }
      
      // Force https for everything related to sharing
      if (publicUrl.startsWith("http://")) {
        publicUrl = publicUrl.replace("http://", "https://");
      }
      
      const cleanPublicUrl = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
      const currentUrl = cleanPublicUrl + req.originalUrl;

      if (cardId) {
        try {
          const cardDoc = await getDoc(doc(db, "flashcards", cardId));
          if (cardDoc.exists()) {
            const card = cardDoc.data();
            title = card.title || title;
            description = card.description || card.topic || description;
            // Use the new .png proxy URL for better compatibility
            imageUrl = `${cleanPublicUrl}/api/card-image/${cardId}.png`;
          }
        } catch (err) {
          console.error("[OG Debug] Error fetching card:", err);
        }
      }

      let template: string;
      if (process.env.NODE_ENV !== "production") {
        template = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
      } else {
        template = fs.readFileSync(path.resolve(__dirname, "dist/index.html"), "utf-8");
      }

      // Inject public URL for client-side sharing
      template = template.replace(
        "</body>",
        `<script>window.__PUBLIC_SHARE_URL__ = "${cleanPublicUrl}";</script></body>`
      );

      // Replace meta tags
      template = template
        .replace(/{{OG_TITLE}}/g, title)
        .replace(/{{OG_DESCRIPTION}}/g, description)
        .replace(/{{OG_IMAGE}}/g, imageUrl)
        .replace(/{{OG_URL}}/g, currentUrl);
      
      // Also update title tag
      if (cardId && title !== "Nur Flashcards") {
        template = template.replace(/<title>.*<\/title>/, `<title>${title} | Nur Flashcards</title>`);
      }

      res.status(200).set({ 
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }).end(template);
    } catch (e) {
      if (process.env.NODE_ENV !== "production" && vite) {
        vite.ssrFixStacktrace(e);
      }
      next(e);
    }
  });

  if (process.env.NODE_ENV !== "production") {
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
