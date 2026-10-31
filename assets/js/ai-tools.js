// ======================================================
// AI Tools Module
// 1. ATS Score — client-side keyword matching (free)
// 2. Grammar Checker — LanguageTool public API (no key)
// 3. Tone Checker — Google Gemini Flash (free key)
// ======================================================

// ── 1. ATS SCORE ──────────────────────────────────────
function checkATS() {
  const jobDesc = document.getElementById('jobDescription').value.trim();
  if (!jobDesc) {
    showToast('Please paste a job description first', 'error');
    return;
  }

  const resumeText = getResumeText();
  if (!resumeText) {
    showToast('Please fill in your resume first', 'error');
    return;
  }

  // Extract keywords from job description
  const stopWords = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with',
    'as','by','is','are','was','were','be','been','have','has','had','do',
    'does','did','will','would','could','should','may','might','shall','can',
    'not','we','you','they','he','she','it','this','that','these','those',
    'our','your','their','its','my','your','his','her','their'
  ]);

  const extractKeywords = (text) => {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s\+\#]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  };

  const jobKeywords = [...new Set(extractKeywords(jobDesc))];
  const resumeWords = extractKeywords(resumeText);
  const resumeWordSet = new Set(resumeWords);

  const matched = jobKeywords.filter(kw => resumeWordSet.has(kw));
  const missing = jobKeywords.filter(kw => !resumeWordSet.has(kw)).slice(0, 15);

  const score = jobKeywords.length > 0
    ? Math.round((matched.length / jobKeywords.length) * 100)
    : 0;

  const scoreColor = score >= 70 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  const scoreLabel = score >= 70 ? 'Strong Match ✅' : score >= 50 ? 'Moderate Match ⚠️' : 'Weak Match ❌';

  const resultDiv = document.getElementById('atsResult');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
    <div class="ats-score-display">
      <div class="ats-score-circle" style="border-color:${scoreColor}; color:${scoreColor}">
        <span class="ats-score-num">${score}%</span>
        <span class="ats-score-lbl">ATS Score</span>
      </div>
      <div class="ats-score-details">
        <div class="ats-label" style="color:${scoreColor}">${scoreLabel}</div>
        <div class="ats-stat">✅ Matched: <strong>${matched.length}</strong> of <strong>${jobKeywords.length}</strong> keywords</div>
        ${missing.length > 0 ? `
        <div class="ats-missing">
          <strong>⚡ Consider adding:</strong>
          <div class="missing-tags">
            ${missing.map(w => `<span class="missing-tag">${w}</span>`).join('')}
          </div>
        </div>` : '<div class="ats-stat">🎉 All key terms matched!</div>'}
      </div>
    </div>
  `;
}

// Helper: get the resume's own text as a single string.
// Built from collectFormData() so it only contains resume content. Reading
// every .form-input on the page would also pick up the job description
// (making every ATS keyword "match"), the Gemini API key, and any sign-in
// or account fields, and send them to LanguageTool and Gemini.
function getResumeText() {
  const data = collectFormData();
  const skipKeys = new Set(['image', 'level', 'link', 'current']);
  const parts = [];
  const walk = (value) => {
    if (typeof value === 'string') { if (value.trim()) parts.push(value.trim()); }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value)) if (!skipKeys.has(key)) walk(v);
    }
  };
  walk([data.personal, data.experiences, data.educations, data.skills,
        data.projects, data.achievements, data.customSections]);
  return parts.join('\n');
}


// ── 2. GRAMMAR CHECKER (LanguageTool) ─────────────────
async function checkGrammar(text) {
  if (!text || text.length < 10) return [];

  try {
    const response = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `text=${encodeURIComponent(text)}&language=en-US&enabledOnly=false`
    });
    const data = await response.json();
    return data.matches || [];
  } catch (err) {
    console.warn('LanguageTool error:', err);
    return [];
  }
}


// ── 3. TONE CHECKER (Google Gemini) ───────────────────
// "gemini-flash-latest" is Google's alias for the current Flash model, so
// the tool keeps working when older model versions are retired (as
// gemini-1.5-flash was). If it stays overloaded, fall back to a smaller
// model, which usually has spare capacity.
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash-lite';

// Waits before each retry of the same model (exponential backoff, as
// Google's troubleshooting guide recommends for 429 / 5xx errors).
const GEMINI_RETRY_DELAYS_MS = [1000, 2000, 4000];

class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// 429 (rate limit), 408 (timeout) and 5xx (server busy) are temporary.
// Others, such as 400/403 for a bad key, will fail the same way every time.
function isRetryableGeminiStatus(status) {
  return status === 429 || status === 408 || status >= 500;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callGemini(model, body, apiKey) {
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      // Key goes in a header rather than the URL, so it doesn't end up in
      // browser history, logs, or error messages that echo the URL.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new GeminiError('Could not reach Gemini. Check your internet connection.', 0);
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new GeminiError(err.error?.message || `Gemini API error (${response.status})`, response.status);
  }
  return response.json();
}

// Tries the main model with retries, then the fallback model once.
// onStatus(text) lets the caller show progress while it waits.
async function callGeminiWithRetry(body, apiKey, onStatus = () => {}) {
  let lastError;
  for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await callGemini(GEMINI_MODEL, body, apiKey);
    } catch (e) {
      lastError = e;
      if (!isRetryableGeminiStatus(e.status)) throw e;
      if (attempt < GEMINI_RETRY_DELAYS_MS.length) {
        const wait = GEMINI_RETRY_DELAYS_MS[attempt];
        onStatus(`Gemini is busy, retrying in ${wait / 1000}s (attempt ${attempt + 2} of ${GEMINI_RETRY_DELAYS_MS.length + 1})...`);
        await sleep(wait);
      }
    }
  }
  onStatus('Gemini is still busy, trying a lighter model...');
  try {
    return await callGemini(GEMINI_FALLBACK_MODEL, body, apiKey);
  } catch (e) {
    // Report the main model's error: the key already worked there, so a
    // fallback-only failure (e.g. that model isn't enabled for this key)
    // shouldn't be shown as "your key is wrong".
    throw lastError;
  }
}

// A hint that matches what actually went wrong, instead of always blaming the key.
function geminiErrorHint(status) {
  if (status === 400 || status === 401 || status === 403) return 'Check that your Gemini API key above is correct.';
  if (status === 429) return 'You have hit the free usage limit for now. Wait a minute and try again.';
  if (status >= 500) return "Google's servers are busy right now. Your key is fine, please try again in a minute.";
  return 'Please try again.';
}

async function checkToneWithGemini(text, apiKey, onStatus) {
  const prompt = `You are a professional resume writing expert. Analyze the following resume content and provide:
1. Overall tone assessment (Professional/Casual/Weak/Strong)
2. Top 3 specific improvements for tone and impact
3. Flag any passive voice sentences
4. Suggest 2-3 power verbs to replace weak words

Resume text:
"""
${text.slice(0, 3000)}
"""

Respond in this exact JSON format:
{
  "tone": "Professional|Casual|Weak|Strong",
  "toneScore": 75,
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "passiveVoice": ["example passive sentence if any"],
  "powerVerbs": ["verb1", "verb2", "verb3"],
  "summary": "One sentence overall assessment"
}`;

  const data = await callGeminiWithRetry({
    contents: [{ parts: [{ text: prompt }] }],
    // Newer models spend part of the token budget on internal reasoning,
    // so 1024 tokens could cut the JSON answer off midway.
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' }
  }, apiKey, onStatus);

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse JSON from response
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse Gemini response');
  return JSON.parse(jsonMatch[0]);
}


// ── COMBINED: Grammar + Tone ───────────────────────────
async function checkGrammarAndTone() {
  // Prefer whatever the user currently has typed in the field — falling back
  // to the previously saved key only if the field is empty. Otherwise typing
  // a new key without clicking "Save" would silently keep using the old one.
  const apiKey = document.getElementById('geminiApiKey').value.trim() || localStorage.getItem('geminiApiKey') || '';
  const resumeText = getResumeText();

  if (!resumeText || resumeText.trim().length < 50) {
    showToast('Please fill in your resume content first', 'error');
    return;
  }

  const resultDiv = document.getElementById('grammarResult');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
    <div class="ai-loading">
      <i class="fas fa-spinner fa-spin"></i>
      <span>Analyzing grammar with LanguageTool...</span>
    </div>`;

  try {
    // Step 1: Grammar check (LanguageTool - free, no key)
    const grammarIssues = await checkGrammar(resumeText);

    const showLoading = (message) => {
      resultDiv.innerHTML = `
        <div class="ai-loading">
          <i class="fas fa-spinner fa-spin"></i>
          <span>${escapeHTML(message)}</span>
        </div>`;
    };
    showLoading('Checking tone with Gemini AI...');

    // Step 2: Tone check (Gemini - needs key)
    let toneData = null;
    let toneError = null;
    let toneErrorHint = '';
    if (apiKey) {
      try {
        toneData = await checkToneWithGemini(resumeText, apiKey, showLoading);
      } catch (e) {
        toneError = e.message;
        toneErrorHint = geminiErrorHint(e.status);
      }
    }

    // Render results
    const grammarHtml = grammarIssues.length > 0
      ? `<div class="grammar-issues">
          <h5>📝 Grammar Issues Found (${grammarIssues.length})</h5>
          ${grammarIssues.slice(0, 8).map(issue => `
            <div class="grammar-issue">
              <span class="issue-text">"${escapeHTML(issue.context?.text?.slice(
                issue.context.offset,
                issue.context.offset + issue.context.length
              ))}"</span>
              <span class="issue-msg">${escapeHTML(issue.message)}</span>
              ${issue.replacements?.length > 0
                ? `<span class="issue-fix">Suggestion: <strong>${escapeHTML(issue.replacements.slice(0,3).map(r=>r.value).join(', '))}</strong></span>`
                : ''}
            </div>`).join('')}
        </div>`
      : `<div class="grammar-ok">✅ No major grammar issues found!</div>`;

    const toneHtml = toneData
      ? `<div class="tone-results">
          <h5>🎯 Tone Analysis (Gemini)</h5>
          <div class="tone-score-row">
            <span class="tone-badge tone-${escapeHTML(String(toneData.tone || '').toLowerCase().replace(/[^a-z]/g, ''))}">${escapeHTML(toneData.tone)}</span>
            <span class="tone-score">${escapeHTML(toneData.toneScore)}/100</span>
          </div>
          <p class="tone-summary">${escapeHTML(toneData.summary)}</p>
          ${toneData.improvements?.length > 0 ? `
          <div class="tone-improvements">
            <strong>💡 Improvements:</strong>
            <ul>${toneData.improvements.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</ul>
          </div>` : ''}
          ${toneData.powerVerbs?.length > 0 ? `
          <div class="power-verbs">
            <strong>⚡ Power Verbs to Use:</strong>
            <div class="verb-tags">${toneData.powerVerbs.map(v => `<span class="verb-tag">${escapeHTML(v)}</span>`).join('')}</div>
          </div>` : ''}
        </div>`
      : toneError
        ? `<div class="tone-error">⚠️ Gemini: ${escapeHTML(toneError)}<br><small>${escapeHTML(toneErrorHint)}</small></div>`
        : `<div class="tone-error">ℹ️ Enter your Gemini API key above to enable tone analysis</div>`;

    resultDiv.innerHTML = grammarHtml + toneHtml;

  } catch (err) {
    resultDiv.innerHTML = `<div class="ai-error">❌ Error: ${escapeHTML(err.message)}</div>`;
  }
}

function saveApiKey() {
  const key = document.getElementById('geminiApiKey').value.trim();
  if (key) {
    localStorage.setItem('geminiApiKey', key);
    showToast('✅ API key saved locally', 'success');
  }
}

// Load saved API key on page load
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('geminiApiKey');
  if (saved) {
    const el = document.getElementById('geminiApiKey');
    if (el) el.value = saved;
  }
});
