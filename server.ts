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

  console.log("[OG Debug] Environment Variables (Keys):", Object.keys(process.env).filter(k => k.includes("URL") || k.includes("HOST")));
  console.log("[OG Debug] APP_URL:", process.env.APP_URL);

  let vite: any;
  if (process.env.NODE_ENV !== "production") {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
  }

  app.get("*", async (req, res, next) => {
    const url = req.originalUrl;
    const cardId = req.query.card as string;

    // Skip for static assets and internal vite requests
    if (url.includes(".") || url.startsWith("/@") || url.startsWith("/node_modules")) {
      return next();
    }

    console.log(`[OG Debug] Request for URL: ${url}, Card ID: ${cardId || 'none'}`);

    try {
      let template: string;
      if (process.env.NODE_ENV !== "production") {
        template = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
      } else {
        template = fs.readFileSync(path.resolve(__dirname, "dist/index.html"), "utf-8");
      }

      let title = "Nur Flashcards";
      let description = "Wisdom in every card. Explore and share flashcards.";
      let imageUrl = "https://picsum.photos/seed/wisdom/1200/630";
      
      // Construct base URL carefully
      let publicUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      
      // If we are on the dev domain, try to point to the pre (shared) domain for sharing
      if (publicUrl.includes("-dev-")) {
        publicUrl = publicUrl.replace("-dev-", "-pre-");
      }
      
      const cleanPublicUrl = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
      const currentUrl = cleanPublicUrl + req.originalUrl;

      if (cardId) {
        try {
          const cardDoc = await getDoc(doc(db, "flashcards", cardId));
          if (cardDoc.exists()) {
            const card = cardDoc.data();
            title = card.title || title;
            description = card.topic || description;
            imageUrl = card.imageUrl || imageUrl;
            console.log(`[OG Debug] Found card: ${title}, Image: ${imageUrl}`);
          } else {
            console.log(`[OG Debug] Card not found: ${cardId}`);
          }
        } catch (err) {
          console.error("[OG Debug] Error fetching card:", err);
        }
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
