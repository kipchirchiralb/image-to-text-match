const path = require('path');
const express = require('express');
const multer = require('multer');
const { upload } = require('./src/upload');
const { recognize, shutdown } = require('./src/ocr');
const { searchText } = require('./src/search');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.render('index', { error: null, query: '' });
});

// HTML form flow: upload image + query, render the match percentage.
app.post('/search', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    const query = (req.body && req.body.query) || '';

    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Image is too large (max 10 MB).'
          : err.message;
      return res.status(400).render('index', { error: message, query });
    }
    if (!req.file) return res.status(400).render('index', { error: 'Please choose an image.', query });
    if (!query.trim()) {
      return res.status(400).render('index', { error: 'Please enter the text to search for.', query });
    }

    try {
      const started = Date.now();
      const ocr = await recognize(req.file.path);
      const { best, matches } = searchText(ocr.text, query);

      res.render('result', {
        query,
        imageUrl: `/uploads/${encodeURIComponent(req.file.filename)}`,
        storedAs: req.file.filename,
        originalName: req.file.originalname,
        ocrText: ocr.text,
        ocrConfidence: Math.round(ocr.confidence),
        best,
        matches,
        ms: Date.now() - started,
      });
    } catch (e) {
      console.error(e);
      res.status(500).render('index', { error: `OCR failed: ${e.message}`, query });
    }
  });
});

// JSON flow: POST multipart/form-data with fields "image" and "query".
app.post('/api/search', upload.single('image'), async (req, res) => {
  const query = (req.body && req.body.query) || '';
  if (!req.file || !query.trim()) {
    return res.status(400).json({ error: 'Both "image" and "query" are required.' });
  }
  try {
    const ocr = await recognize(req.file.path);
    const { best, matches } = searchText(ocr.text, query);
    res.json({
      query,
      file: req.file.filename,
      found: Boolean(best),
      percent: best ? best.percent : 0,
      matchedText: best ? best.matchedText : null,
      matches: matches.map(({ segments, ...m }) => m),
      ocrConfidence: Math.round(ocr.confidence),
      ocrText: ocr.text,
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
