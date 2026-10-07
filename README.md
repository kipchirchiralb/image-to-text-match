# OCR + Fuzzy Search (no LLM)

Upload an image, type the text you are looking for and a phone number, and get back a **match percentage** on screen plus a short **SMS report** to that phone.

- **[Tesseract.js](https://github.com/naptha/tesseract.js)** reads the text out of the image (OCR).
- **[fuzzy](https://www.npmjs.com/package/fuzzy)** finds the closest match to your search text inside that OCR output and scores it.
- **Express + EJS** serve a small web UI, and **Multer** handles the upload.
- **[TextSMS](https://textsms.co.ke)** sends the SMS report.

There is no LLM and no generative AI. OCR runs on a small, task-specific neural network that ships with Tesseract and runs locally. OCR and matching need no API key and have no per-request cost. The image never leaves your server. The only thing sent out is the short SMS report text, through TextSMS. See [Is this AI?](#is-this-ai) for the details.

---

## Table of contents

1. [Quick start](#quick-start)
2. [How it works](#how-it-works)
3. [Is this AI?](#is-this-ai)
4. [Why OCR + fuzzy matching instead of an LLM](#why-ocr--fuzzy-matching-instead-of-an-llm)
5. [When this works well, and when it does not](#when-this-works-well-and-when-it-does-not)
6. [How the match percentage is calculated](#how-the-match-percentage-is-calculated)
7. [SMS report (TextSMS)](#sms-report-textsms)
8. [API](#api)
9. [Project structure](#project-structure)
10. [Configuration](#configuration)
11. [Improving accuracy](#improving-accuracy)
12. [Troubleshooting](#troubleshooting)

---

## Quick start

Requirements: Node.js 18 or newer (tested on Node 24).

```bash
npm install
cp .env.example .env   # then put your TextSMS API key and partner ID in .env
npm start              # or: npm run dev  (auto-restarts on file changes)
```

Open <http://localhost:3000>, choose an image, type a search phrase such as `Date of Birth`, enter a phone number, and submit.

> **First run needs internet.** Tesseract.js downloads the trained English OCR model (`eng.traineddata`, about 10 MB) the first time it runs and caches it in the project folder. After that it works offline.

---

## How it works

```
 ┌────────────┐   multipart    ┌──────────┐   image path   ┌──────────────┐   raw text   ┌──────────────┐
 │  Browser   │ ─────────────▶ │  Multer  │ ─────────────▶ │ Tesseract.js │ ───────────▶ │ fuzzy search │
 │ image+text │                │ uploads/ │                │    (OCR)     │              │  + scoring   │
 └────────────┘                └──────────┘                └──────────────┘              └──────┬───────┘
       ▲                                                                                        │
       └───────────────────────────── best match %, all matches, highlighted text ◀─────────────┘
```

1. **Upload.** Multer saves the file to `uploads/` as `<original-name>-<timestamp>-<random-hex><original-extension>`.
   For example, `my id card.PNG` becomes `my_id_card-1791213280410-468fa77a.png`.
   Unsafe characters are replaced with `_`, only image types are accepted, and the size limit is 10 MB.
2. **OCR.** One Tesseract.js worker is created on the first request and reused for every request after that, which avoids reloading the OCR model each time.
3. **Search.** The OCR text is split into lines. Your query is compared against each full line, and against word windows inside each line that are about the same length as your query. That way, searching for `john kamau` on the line `FULL NAMES: JOHN KAMAU MWANGI` scores the `JOHN KAMAU` part, not the whole line.
4. **Score and respond.** Each line's best candidate gets a 0–100% score. The page shows the best match with the matched characters highlighted, a ranked table of all matches above 30%, the uploaded image, and the raw OCR text.
5. **SMS report.** A one-line summary of the best match is sent to the phone number through TextSMS. The results page shows whether the SMS was sent and the exact text.

---

## Is this AI?

Partly. It depends on which half of the pipeline you look at.

| Part | Is it AI? | What it actually is |
|---|---|---|
| **OCR (Tesseract.js)** | Yes, machine learning | Since version 4, Tesseract recognizes text with an LSTM, a type of neural network trained on large sets of text images. `eng.traineddata` holds the trained weights. It is small, runs on the CPU, and does one job: turning pixels into characters. |
| **Matching (fuzzy)** | No | A deterministic string algorithm. It checks whether characters appear in order and scores the result with fixed rules. Nothing is trained or learned. |
| **LLM or generative AI** | Not used | Nothing in this project generates text, reasons about content, or calls a large language model. |

So the accurate description is: **a small, local, task-specific machine-learning model for OCR, plus deterministic fuzzy matching, with no LLM or generative AI.**

The real contrast with an LLM is *narrow and specialized* versus *large and general purpose*, not "AI versus no AI". That difference is what drives the cost, privacy, and determinism benefits described below.

---

## Why OCR + fuzzy matching instead of an LLM

LLMs (including vision models) are very good at reading messy documents and "understanding" them. For many real tasks, though, the question is narrower: *"Does this image contain this text, and how closely?"* For that question, a small specialized OCR model plus a deterministic matcher has real advantages.

| Concern | OCR + fuzzy | LLM / vision model |
|---|---|---|
| **Cost** | Free after setup. Runs on your own CPU. | Paid per request or needs a GPU. Costs grow with volume. |
| **Privacy** | Images never leave your server. | Images usually go to a third-party API. This matters for IDs, medical forms, and invoices. |
| **Determinism** | Same image + same query = same score, every time. | Output can vary between runs and between model versions. |
| **Explainability** | The matching step is fully transparent: you can see exactly which characters matched and why the score is what it is. The OCR output is shown too, so you can check what the model read. | The model's answer is hard to audit. |
| **Hallucination** | No generative step, so it cannot invent text. OCR can misread characters, but it only transcribes what is on the image. If text is not in the OCR output, it is not found. | Can confidently "read" text that is not there, or fix typos you wanted to catch. |
| **Latency** | Typically under a second per image after warm-up. | Network round trip plus model inference, often several seconds. |
| **Offline** | Works with no internet once the language file is cached. | Needs network access to the provider. |
| **Dependencies** | Pure JavaScript. `npm install` and go. | API keys, rate limits, quotas, SDK upgrades. |
| **Score you can threshold** | Gives a number you can set business rules on, like "auto-approve at 85% or above". | Confidence is not well calibrated unless you build extra machinery. |

### The core idea

OCR is good at turning pixels into characters but makes small mistakes: `O` read as `0`, `rn` read as `m`, dropped spaces, stray punctuation.
Fuzzy matching is good at saying "these two strings are almost the same" in spite of exactly those small mistakes.
Together they cover each other's weaknesses for the job of **finding known text in an image**. You do not need a large model that understands language when you already know what you are looking for.

---

## When this works well, and when it does not

### Good fits

- **Verifying that a document contains expected text.** Does this certificate contain the student's name? Does this receipt contain the order number?
- **KYC and ID checks.** Compare the name the user typed with the name printed on their ID card and flag anything below a threshold for manual review.
- **Finding labels on forms.** Locate `Date of Birth`, `Invoice No`, or `Total` on scanned forms with a consistent layout.
- **Matching against a known list.** Product names on labels, plate numbers, or serial numbers.
- **Clean, printed text.** Screenshots, scanned documents, printed receipts, and typed forms.
- **High volume or sensitive data** where per-call API pricing or sending data to a third party is a problem.

### Poor fits

- **Handwriting.** Tesseract is trained for printed text. Handwritten input gives poor OCR, and no amount of fuzzy matching fixes text that was never read.
- **Photos with heavy blur, glare, skew, or low resolution.** OCR quality drops sharply. See [Improving accuracy](#improving-accuracy).
- **Questions that need understanding** rather than matching. "What is the total after tax?", "Is this invoice overdue?", or "Summarize this letter" are LLM tasks.
- **Unknown structure.** If you do not know what text to look for, fuzzy search has nothing to compare against.
- **Semantic matches.** Fuzzy matches characters, not meaning. `DOB` will not match `Date of Birth`, and `car` will not match `vehicle`. Search for each synonym, or use an LLM or embeddings.
- **Complex layouts.** Multi-column documents, tables, and rotated text can come out of OCR in a jumbled line order, which breaks line-based matching.

### A practical middle ground

Use this pipeline as the **first pass**. Auto-accept high scores, reject very low ones, and send only the uncertain middle band (say 50–80%) to a human or an LLM. This keeps most of the cost and privacy benefits while handling hard cases.

---

## How the match percentage is calculated

The logic lives in `src/search.js`.

### 1. What the `fuzzy` library does

`fuzzy.match(pattern, text)` checks whether every character of the pattern appears **in order** in the text, though not necessarily next to each other. This is called subsequence matching. It returns a raw score that grows **exponentially** with runs of consecutive matching characters. It returns `Infinity` for an exact match and `null` if the pattern is not a subsequence at all.

```js
fuzzy.match('dob', 'date of birth') // matches: d...o...b, low score (no consecutive run)
fuzzy.match('date', 'date of birth') // matches: 'date' consecutive, high score
fuzzy.match('name', 'narne')        // null: there is no 'm' in 'narne'
```

### 2. Turning the raw score into a percentage

Because the raw score is exponential, it is converted like this:

1. Compute the best possible raw score for a pattern of that length, where every character is consecutive.
2. Take `log2(score + 1) / log2(best + 1)` to bring it onto a linear 0–1 scale.
3. Take the square root of that, so a single broken run (one OCR error in the middle of a word) does not crush the score.

### 3. Tolerating OCR errors

Plain subsequence matching fails if OCR changed even one character, because that character then cannot be found. To handle this, the search adds two fallbacks:

- **One character dropped.** If the query does not match, the query is retried with each single character removed, with a 15% penalty. `name` against OCR text `narne` then matches through `nae`.
- **Spaces ignored.** The query and the text are also compared with all spaces removed, because OCR often drops or adds spaces. `date of birth` against `DATEOFBIRTH` scores 100%.

### 4. Length penalty

A short query hiding inside a long candidate should not score 100%. The score is multiplied by `sqrt(shorter length / longer length)`. So `date` against `date of birth` scores about 60%, not 100%.

### Example scores

| Search text | Text found in image | Score |
|---|---|---|
| `date of birth` | `DATE OF BIRTH:` | 100% |
| `john kamau` | `JOHN KAMAU` | 100% |
| `ID numbr` (typo in query) | `ID NUMBER:` | 89% |
| `kamau` | `kamua` | 85% |
| `total` | `t0tal` (OCR error) | 75% |
| `date of birth` | `date 0f birth` (OCR error) | 69% |
| `name` | `narne` (OCR error) | 65% |
| `date` | `date of birth` | 60% |
| `passport` | (not in image) | 0% |

Only matches at or above 30% are listed. A rough guide for setting thresholds: **80% or more** is a confident match, **50–79%** is likely but worth a look, and **below 50%** is probably not there.

---

## SMS report (TextSMS)

After each search, the app sends a single SMS (160 characters or fewer) to the phone number entered on the form. Examples:

```
OCR search "date of birth": 100% match. Found "DATE OF BIRTH:" on line 3.
OCR search "passport": no match found in the image.
```

Long search phrases and matches are shortened with `...` so the message always fits in one SMS.

### Setting up TextSMS

1. Sign in to your [TextSMS](https://textsms.co.ke) account and copy your **API key** and **Partner ID**.
2. Copy `.env.example` to `.env` and set `TEXTSMS_API_KEY` and `TEXTSMS_PARTNER_ID`.
3. Set `TEXTSMS_SENDER_ID` to your approved sender ID or shortcode.
4. Restart the server and run a search. SMS is charged per message.

The sending code lives in `textsms.js` (`sendTextSMS`), and `src/sms.js` uses it.

### Phone numbers

Numbers are converted to international format before sending. With `DEFAULT_COUNTRY_CODE=254`, all of these become `+254712345678`:

```
0712345678   +254 712 345 678   254712345678   00254712345678
```

An invalid number stops the request with an error before OCR runs.

### If the SMS fails

The search still completes. The results page, or the `sms` field in the API response, shows the error from TextSMS. An SMS failure never hides the match result.

---

## API

The same search is available as JSON for scripts and other services.

**`POST /api/search`** with `multipart/form-data`:

| Field | Type | Description |
|---|---|---|
| `image` | file | The image to read. PNG, JPG, JPEG, BMP, WEBP, TIF, TIFF, or GIF. Max 10 MB. |
| `query` | text | The text to look for. |
| `phone` | text | Optional. If present, the SMS report is sent to this number. |

```bash
curl -F "image=@./id-card.png" -F "query=date of birth" -F "phone=0712345678" http://localhost:3000/api/search
```

Response:

```json
{
  "query": "date of birth",
  "file": "id-card-1791213280410-468fa77a.png",
  "found": true,
  "percent": 100,
  "matchedText": "DATE OF BIRTH:",
  "matches": [
    { "percent": 100, "matchedText": "DATE OF BIRTH:", "line": "DATE OF BIRTH: 12.03.1990", "lineNumber": 3 }
  ],
  "ocrConfidence": 91,
  "ocrText": "REPUBLIC OF KENYA\nFULL NAMES: JOHN KAMAU MWANGI\nDATE OF BIRTH: 12.03.1990\n...",
  "sms": {
    "sent": true,
    "to": "+254712345678",
    "message": "OCR search \"date of birth\": 100% match. Found \"DATE OF BIRTH:\" on line 3.",
    "status": "Success",
    "cost": "KES 0.8000",
    "messageId": "ATXid_..."
  }
}
```

`sms` is `null` when no phone is given. If sending fails, `sms.sent` is `false` and `sms.error` holds the reason. Errors return HTTP 400 for a missing or invalid input, and HTTP 500 if OCR fails. Both use the shape `{ "error": "message" }`.

The browser form posts to **`POST /search`** with the same fields and renders an HTML results page. On the form, the phone number is required.

---

## Project structure

```
.
├── app.js              Express server and routes (/, /search, /api/search)
├── .env.example        Template for .env (TextSMS credentials, port)
├── textsms.js          TextSMS API call (sendTextSMS)
├── src/
│   ├── upload.js       Multer config: disk storage, unique filenames, image filter, 10 MB limit
│   ├── ocr.js          Tesseract.js worker, created once and reused
│   ├── search.js       Fuzzy matching, scoring, and highlighting
│   └── sms.js          TextSMS wrapper, phone normalisation, SMS report text
├── views/
│   ├── index.ejs       Upload form (image, search text, phone) with image preview
│   ├── result.ejs      Match percentage, SMS status, highlighted matches, raw OCR text
│   └── partials-head.ejs
├── public/style.css    Styles, including dark mode
└── uploads/            Stored images (git-ignored, not served over HTTP)
```

---

## Configuration

Environment variables live in `.env`. Copy `.env.example` to start. `.env` is git-ignored, so your key is never committed.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Web server port | `3000` |
| `TEXTSMS_API_KEY` | TextSMS API key | required for SMS |
| `TEXTSMS_PARTNER_ID` | TextSMS partner ID | required for SMS |
| `TEXTSMS_SENDER_ID` | Approved sender ID or shortcode | `TextSMS` |
| `DEFAULT_COUNTRY_CODE` | Turns local numbers like `0712...` into `+254712...` | empty |

Other settings live in code:

| Setting | Where | Default |
|---|---|---|
| Max upload size | `limits.fileSize` in `src/upload.js` | 10 MB |
| Allowed extensions | `ALLOWED` in `src/upload.js` | common image types |
| OCR language | `createWorker('eng')` in `src/ocr.js` | English |
| Minimum % listed and max results | `searchText(text, query, { minPercent, limit })` in `src/search.js` | 30%, 10 results |

**Other languages.** Pass another Tesseract language code, or several joined with `+`, to `createWorker`. For example `createWorker('eng+swa')` reads English and Swahili. Each language file is downloaded on first use.

---

## Improving accuracy

Most bad results come from bad OCR, not from the fuzzy step. Open "Raw OCR text" on the results page first. If the text there is wrong, fix the image, not the matching.

- **Use higher resolution.** Text should be at least about 20 pixels tall. Upscale small images before OCR.
- **Increase contrast.** Convert to grayscale and threshold to black and white. A library such as [`sharp`](https://www.npmjs.com/package/sharp) can do this in a few lines before calling `recognize`.
- **Straighten and crop.** Skewed or rotated text and large backgrounds hurt Tesseract.
- **Search for distinctive text.** `ID NUMBER` is easier to find reliably than `NO`.
- **Search for synonyms separately.** Fuzzy matching does not know that `DOB` and `Date of Birth` mean the same thing.

---

## Troubleshooting

- **First request is slow or fails offline.** Tesseract.js is downloading `eng.traineddata`. Make sure the server has internet access on first run. The file is cached in the project folder afterwards.
- **"Only image files are allowed".** The file extension or MIME type was not an accepted image type. PDFs are not supported. Convert PDF pages to images first.
- **"Image is too large".** The file is over 10 MB. Resize it, or raise the limit in `src/upload.js`.
- **Match is 0% but the text is clearly in the image.** Check the raw OCR text. If OCR misread more than one character in a short word, try a shorter or more distinctive query, or improve the image.
- **SMS fails with an authentication error.** TextSMS rejected the API key or partner ID. Copy both again from your TextSMS dashboard and restart the server after editing `.env`.
- **SMS fails with a sender ID error.** `TEXTSMS_SENDER_ID` must be a sender ID approved on your TextSMS account.
- **"SMS is not configured".** `TEXTSMS_API_KEY` or `TEXTSMS_PARTNER_ID` is missing. Create `.env` from `.env.example`.
- **Disk filling up.** Uploaded images are kept in `uploads/`. Delete them on a schedule, or delete each file after processing if you do not need to keep it.
