const Anthropic = require('@anthropic-ai/sdk');

function createClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY manquante dans l\'environnement');
  }
  return new Anthropic();
}

async function withRetry(fn, { retries = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt;
        console.warn(`[llm] échec (tentative ${attempt + 1}), retry dans ${delay} ms :`, err.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

function stripCodeFences(text) {
  return text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
}

module.exports = { createClient, withRetry, stripCodeFences };
