const fuzzy = require('fuzzy');

const normalize = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9@.+\-\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Best raw score fuzzy can give a pattern of length n (every char consecutive).
// fuzzy adds (1 + previous) for each consecutive char, so a run of n = 2^(n+1) - n - 2.
const maxRawScore = (n) => Math.pow(2, n + 1) - n - 2;

// fuzzy's raw score grows exponentially with consecutive characters,
// so we compare on a log scale to get a 0..1 similarity.
function rawSimilarity(pattern, text) {
  const m = fuzzy.match(pattern, text);
  if (!m) return 0;
  if (m.score === Infinity) return 1; // exact match
  const logRatio = Math.log2(m.score + 1) / Math.log2(maxRawScore(pattern.length) + 1);
  return Math.min(1, Math.sqrt(logRatio)); // sqrt keeps one broken run from tanking the %
}

// fuzzy is subsequence matching, so a single mis-read char ("Narne" for "Name")
// makes it fail. Tolerate one OCR error by retrying with one query char removed.
function similarity(query, candidate) {
  // OCR often drops or adds spaces, so also compare with spaces removed.
  const noSpaceQ = query.replace(/ /g, '');
  const noSpaceC = candidate.replace(/ /g, '');
  if (noSpaceQ !== query || noSpaceC !== candidate) {
    const a = scoreOne(query, candidate);
    const b = scoreOne(noSpaceQ, noSpaceC);
    return b.score > a.score ? b : a; // b.pattern has no spaces but still highlights as a subsequence
  }
  return scoreOne(query, candidate);
}

function scoreOne(query, candidate) {
  let best = rawSimilarity(query, candidate);
  let pattern = query;
  if (best === 0 && query.length >= 4) {
    for (let i = 0; i < query.length; i++) {
      const shorter = query.slice(0, i) + query.slice(i + 1);
      const s = rawSimilarity(shorter, candidate) * 0.85;
      if (s > best) { best = s; pattern = shorter; }
    }
  }
  // Penalise length differences so "date" vs "date of birth" isn't 100%.
  const ratio = Math.min(query.length, candidate.length) / Math.max(query.length, candidate.length);
  return { score: best * Math.sqrt(ratio), pattern };
}

// Split a fuzzy-rendered string into [{ text, hit }] segments for safe rendering in EJS.
function highlight(pattern, text) {
  const m = fuzzy.match(pattern, text, { pre: '\u0001', post: '\u0002' });
  if (!m) return [{ text, hit: false }];
  const segments = [];
  m.rendered.split(/(\u0001.\u0002)/u).forEach((part) => {
    if (!part) return;
    const hit = part.startsWith('\u0001');
    const t = hit ? part.slice(1, -1) : part;
    const last = segments[segments.length - 1];
    if (last && last.hit === hit) last.text += t;
    else segments.push({ text: t, hit });
  });
  return segments;
}

/**
 * Fuzzy-search OCR text for `query`.
 * Compares the query against every line and against word windows inside each line
 * that are roughly the same size as the query, then returns matches ranked by %.
 */
function searchText(ocrText, query, { limit = 10, minPercent = 30 } = {}) {
  const q = normalize(query);
  if (!q) return { best: null, matches: [] };
  const qWords = q.split(' ').length;

  const lines = ocrText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const matches = [];

  lines.forEach((line, lineNo) => {
    const words = line.split(/\s+/);
    const seen = new Set();
    let bestForLine = null;

    const consider = (candidate) => {
      const norm = normalize(candidate);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      const { score, pattern } = similarity(q, norm);
      if (!bestForLine || score > bestForLine.score) {
        bestForLine = { score, pattern, candidate };
      }
    };

    consider(line);
    for (let size = Math.max(1, qWords - 1); size <= qWords + 1; size++) {
      for (let i = 0; i + size <= words.length; i++) consider(words.slice(i, i + size).join(' '));
    }

    if (bestForLine) {
      const percent = Math.round(bestForLine.score * 100);
      if (percent >= minPercent) {
        matches.push({
          percent,
          matchedText: bestForLine.candidate,
          line,
          lineNumber: lineNo + 1,
          segments: highlight(bestForLine.pattern, bestForLine.candidate),
        });
      }
    }
  });

  matches.sort((a, b) => b.percent - a.percent);
  return { best: matches[0] || null, matches: matches.slice(0, limit) };
}

module.exports = { searchText, similarity };
