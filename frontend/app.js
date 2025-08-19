"use strict";

const express = require("express");
const request = require("request"); // (deprecated, but fine if you want to keep tutorial parity)
const path = require("path");
require("dotenv").config({ silent: true });

const app = express();
const cors = require("cors");
app.use(cors());

// Parse JSON/form bodies (needed for /submit and any future POSTs)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve all assets from /public (css, js, images)
app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;
const backendURL = (process.env.BACKEND_URL || "").replace(/\/+$/, ""); // strip trailing slash
console.log("backend URL:", backendURL || "(not set)");

// Small helper to handle request errors consistently
function pipeWithError(srcReq, destRes) {
  srcReq.on("error", (err) => {
    console.error("Proxy error:", err);
    if (!destRes.headersSent) destRes.status(502).send(err.message || "Upstream error");
  });
  return srcReq;
}

/* ----------------------------- Routes ------------------------------ */

// Landing route – show 501 if BACKEND_URL is missing
app.get("/", (req, res) => {
  if (!backendURL) {
    return res.sendFile(path.join(__dirname, "public", "501.html"));
  }
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check (useful during deploys)
app.get("/health", (req, res) => res.json({ ok: true, backend: !!backendURL }));

// List files
app.get("/files", (req, res) => {
  if (!backendURL) return res.status(501).send("BACKEND_URL not configured");
  pipeWithError(
    request.get({
      url: `${backendURL}/files`,
      agentOptions: { rejectUnauthorized: false },
    }),
    res
  ).pipe(res);
});

// Upload (streaming proxy to backend /files)
app.post("/uploadfile", (req, res) => {
  if (!backendURL) return res.status(501).send("BACKEND_URL not configured");
  const r = pipeWithError(
    request.post({
      url: `${backendURL}/files`,
      agentOptions: { rejectUnauthorized: false },
      // forward content-type & boundary for multipart uploads
      headers: { "content-type": req.headers["content-type"] },
    }),
    res
  );
  req.pipe(r).pipe(res);
});

// Results JSON
app.get("/results", (req, res) => {
  if (!backendURL) return res.status(501).send("BACKEND_URL not configured");
  pipeWithError(
    request.get({
      url: `${backendURL}/results`,
      agentOptions: { rejectUnauthorized: false },
    }),
    res
  ).pipe(res);
});

// Delete a file
app.delete("/file", (req, res) => {
  if (!backendURL) return res.status(501).send("BACKEND_URL not configured");
  const itemName = req.query.filename;
  if (!itemName) return res.status(400).send("filename query param is required");

  pipeWithError(
    request.delete({
      url: `${backendURL}/file`,
      qs: { filename: itemName },
      agentOptions: { rejectUnauthorized: false },
    }),
    res
  ).pipe(res);
});

// Questionnaire submission → forward JSON to backend /submit
app.post("/submit", (req, res) => {
  if (!backendURL) return res.status(501).send("BACKEND_URL not configured");
  request(
    {
      method: "POST",
      url: `${backendURL}/submit`,
      json: true,                 // send JSON and parse JSON response
      body: req.body,
      agentOptions: { rejectUnauthorized: false },
    },
    (err, upstreamRes, body) => {
      if (err) {
        console.error("Submit proxy error:", err);
        return res.status(502).send(err.message || "Upstream error");
      }
      res.status(upstreamRes?.statusCode || 200).send(body);
    }
  );
});

// Generic error handler
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send(error.message || "Internal server error");
});

app.listen(port, () => console.log(`App listening on port ${port}!`));
