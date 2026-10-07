require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { upload } = require('./src/upload');
const { recognize, shutdown } = require('./src/ocr');
const { searchText } = require('./src/search');
const { sendReport, normalizePhone } = require('./src/sms');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index', { error: null, query: '', phone: '' });
});

// HTML form flow: upload image + query, render the match percentage.
app.post('/search', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    const query = (req.body && req.body.query) || '';
    const phoneInput = (req.body && req.body.phone) || '';
    const fail = (status, error) => res.status(status).render('index', { error, query, phone: phoneInput });

    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Image is too large (max 10 MB).'
          : err.message;
      return fail(400, message);
    }
    if (!req.file) return fail(400, 'Please choose an image.');
    if (!query.trim()) return fail(400, 'Please enter the text to search for.');
    const phone = normalizePhone(phoneInput);
    if (!phone) return fail(400, 'Please enter a valid phone number, e.g. +254712345678.');

    try {
      const started = Date.now();
      const ocr = await recognize(req.file.path);
      const { best, matches } = searchText(ocr.text, query);
      const sms = await sendReport(phone, query, best);
      // uploads/ is not served publicly, so inline the image for this one response.
      const image = await fs.promises.readFile(req.file.path);

      res.render('result', {
        query,
        imageUrl: `data:${req.file.mimetype};base64,${image.toString('base64')}`,
        storedAs: req.file.filename,
        originalName: req.file.originalname,
        ocrText: ocr.text,
        ocrConfidence: Math.round(ocr.confidence),
        best,
        matches,
        ms: Date.now() - started,
        sms,
      });
    } catch (e) {
      console.error(e);
      fail(500, `OCR failed: ${e.message}`);
    }
  });
});

// JSON flow: POST multipart/form-data with fields "image", "query" and optional "phone".
app.post('/api/search', upload.single('image'), async (req, res) => {
  const query = (req.body && req.body.query) || '';
  if (!req.file || !query.trim()) {
    return res.status(400).json({ error: 'Both "image" and "query" are required.' });
  }
  const phone = req.body.phone ? normalizePhone(req.body.phone) : null;
  if (req.body.phone && !phone) return res.status(400).json({ error: 'Invalid phone number.' });
  try {
    const ocr = await recognize(req.file.path);
    const { best, matches } = searchText(ocr.text, query);
    const sms = phone ? await sendReport(phone, query, best) : null;
    res.json({
      query,
      file: req.file.filename,
      found: Boolean(best),
      percent: best ? best.percent : 0,
      matchedText: best ? best.matchedText : null,
      matches: matches.map(({ segments, ...m }) => m),
      ocrConfidence: Math.round(ocr.confidence),
      ocrText: ocr.text,
      sms,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Multer errors on the JSON route (bad file type, too large).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`OCR + fuzzy search running on http://localhost:${PORT}`);
});

const stop = async () => {
  await shutdown();
  server.close(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
