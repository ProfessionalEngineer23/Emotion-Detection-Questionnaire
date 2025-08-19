"use strict";

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const multerS3 = require("multer-s3");
const myCOS = require("ibm-cos-sdk");
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
require("dotenv").config({ silent: true });

const WATSON_NLP_URL = process.env.WATSON_NLP_URL || ""; // e.g. https://<your-watson-runtime>
const WATSON_MODEL   = process.env.WATSON_NLP_MODEL_ID || "emotion_aggregated-workflow_lang_en_stock";

const app = express();
const port = process.env.PORT || 3001;

/* ---------------- Middleware ---------------- */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------- COS client ---------------- */
function getCosClient() {
  const config = {
    endpoint:
      process.env.COS_ENDPOINT || // ⚠ set to e.g. s3.eu-gb.cloud-object-storage.appdomain.cloud
      "s3.us-south.cloud-object-storage.appdomain.cloud",
    apiKeyId: process.env.COS_APIKEY,
    ibmAuthEndpoint: "https://iam.cloud.ibm.com/identity/token",
    serviceInstanceId: process.env.COS_RESOURCE_INSTANCE_ID,
  };
  return new myCOS.S3(config);
}

/* ---------------- Helpers ---------------- */
async function analyzeEmotion(text) {
  if (!WATSON_NLP_URL) return null; // allow running without NLP for now
  const url = `${WATSON_NLP_URL}/v1/watson.runtime.nlp.v1/NlpService/EmotionPredict`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Grpc-Metadata-mm-model-id": WATSON_MODEL
    },
    body: JSON.stringify({ raw_document: { text } })
  });
  if (!r.ok) throw new Error(`Watson NLP ${r.status}`);
  return r.json();
}

async function getItem(bucketName, itemName) {
  const cos = getCosClient();
  console.log(`Retrieving item from bucket: ${bucketName}, key: ${itemName}`);
  const data = await cos.getObject({ Bucket: bucketName, Key: itemName }).promise();
  return data && data.Body ? Buffer.from(data.Body).toString() : "";
}

async function deleteItem(fileName, prefix) {
  const cos = getCosClient();
  const bucketName = process.env.COS_BUCKETNAME;
  const key = `${prefix}/${fileName}`;
  console.log(`Deleting item: ${key}`);
  await cos.deleteObject({ Bucket: bucketName, Key: key }).promise();
  console.log(`Item: ${key} deleted!`);
  return `Item: ${key} deleted!`;
}

/**
 * List bucket contents for a given prefix ("files", "results", etc.)
 * Returns an object: { "<filename>": "<preview or json>", ... }
 */
async function getBucketContents(prefix) {
  const cos = getCosClient();
  const bucketName = process.env.COS_BUCKETNAME;
  console.log(`Retrieving bucket contents from: ${bucketName}`);

  const data = await cos.listObjects({ Bucket: bucketName, Prefix: prefix }).promise();
  if (!data || !data.Contents) return {};

  const items = [];
  const work = data.Contents.map(async (obj) => {
    const itemKey = obj.Key; // e.g. "files/foo.txt"
    if (!itemKey || itemKey.endsWith("/") || obj.Size === 0) return; // skip folder markers
    console.log(`Item: ${itemKey} (${obj.Size} bytes).`);

    const fileKey = itemKey.split("/")[1] || itemKey; // filename only
    const raw = await getItem(bucketName, itemKey);

    const entry = { time: obj.LastModified };
    if (prefix === "results") {
      try {
        entry[fileKey] = JSON.parse(raw);
      } catch {
        entry[fileKey] = { parse_error: true };
      }
    } else {
      entry[fileKey] = (raw || "").substring(0, 150) + "...";
    }
    items.push(entry);
  });

  await Promise.all(work);

  // sort by time ascending and flatten
  items.sort((a, b) => new Date(a.time) - new Date(b.time));
  const finalDict = {};
  items.forEach((it) => {
    const k = Object.keys(it).find((x) => x !== "time");
    if (k) finalDict[k] = it[k];
  });
  return finalDict;
}

/* ---------------- Multer uploader ---------------- */
function uploadFilesToCOS(req, res, next) {
  const upload = multer({
    storage: multerS3({
      s3: getCosClient(),
      bucket: process.env.COS_BUCKETNAME, // bucket only
      metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
      key: (req, file, cb) => cb(null, `files/${file.originalname}`), // prefix in key
    }),
  }).array("files", 10);

  upload(req, res, (err) => {
    if (err) return next(err);
    const n = (req.files || []).length;
    res.send(n === 0 ? "Upload a text file..." :
      `Successfully uploaded ${n} file${n > 1 ? "s" : ""} to Object Storage`);
  });
}

/* ---------------- Routes ---------------- */
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/", (_req, res) => {
  res.send("Hello World! from backend");
});

app.get("/files", async (_req, res, next) => {
  try { res.send(await getBucketContents("files")); }
  catch (err) { next(err); }
});

app.post("/files", uploadFilesToCOS, (_req, _res) => { /* handled above */ });

app.get("/results", async (_req, res, next) => {
  try { res.send(await getBucketContents("results")); }
  catch (err) { next(err); }
});

/** Save questionnaire submission into COS: responses/<timestamp>.json */
app.post("/submit", async (req, res) => {
  try {
    const responses = req.body || {};
    const id = Date.now().toString();
    const bucketName = process.env.COS_BUCKETNAME;
    const cos = getCosClient();

    // 1) store raw answers
    const keyRaw = `responses/${id}.json`;
    await cos.putObject({
      Bucket: bucketName,
      Key: keyRaw,
      Body: JSON.stringify({ ts: new Date().toISOString(), responses }),
      ContentType: "application/json"
    }).promise();

    // 2) optional: run emotion on free-text
    let emotion = null;
    if (responses.feelings) {
      try { emotion = await analyzeEmotion(String(responses.feelings)); }
      catch (e) { console.error("Emotion analysis failed:", e.message); }
    }

    // 3) store analysis (if any)
    if (emotion) {
      const keyResult = `results/${id}.json`;
      await cos.putObject({
        Bucket: bucketName,
        Key: keyResult,
        Body: JSON.stringify({ id, ts: new Date().toISOString(), emotion }),
        ContentType: "application/json"
      }).promise();
    }

    res.json({ ok: true, id, key: keyRaw, analyzed: Boolean(emotion) });
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/file", async (req, res, next) => {
  try {
    const itemName = req.query.filename;
    if (!itemName) return res.status(400).send("filename is required");
    await Promise.all([ // delete both prefixes in parallel
      deleteItem(itemName, "files"),
      deleteItem(itemName, "results"),
    ]);
    res.send(`Item: ${itemName} deleted!`);
  } catch (err) {
    next(err);
  }
});

/* ---------------- 404 + errors ---------------- */
app.use((_req, _res, next) => {
  const error = new Error("Not found");
  error.status = 404;
  next(error);
});

app.use((error, _req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).send({
    error: {
      status: error.status || 500,
      message: error.message || "Internal Server Error",
    },
  });
});

/* ---------------- Start ---------------- */
app.listen(port, "0.0.0.0", () => {
  console.log(`App listening on port ${port}!`);
});
