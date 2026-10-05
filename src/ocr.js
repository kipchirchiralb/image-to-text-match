const { createWorker } = require('tesseract.js');

let workerPromise = null;

// Create the Tesseract worker once and reuse it for every request.
function getWorker() {
  if (!workerPromise) workerPromise = createWorker('eng');
  return workerPromise;
}

async function recognize(imagePath) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagePath);
  return { text: data.text, confidence: data.confidence };
}

async function shutdown() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

module.exports = { recognize, shutdown };
