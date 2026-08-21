// ======================================================
// AI Tools Module
// 1. ATS Score — client-side keyword matching (free)
// 2. Grammar Checker — LanguageTool public API (no key)
// 3. Tone Checker — Google Gemini 1.5 Flash (free key)
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

// Helper: get all resume text as a single string
function getResumeText() {
  const inputs = document.querySelectorAll('.form-input, textarea');
  return Array.from(inputs).map(i => i.value || '').join(' ');
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


// ── 3. TONE CHECKER (Google Gemini 1.5 Flash) ─────────
async function checkToneWithGemini(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Gemini API error');
  }

  const data = await response.json();
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

    resultDiv.innerHTML = `
      <div class="ai-loading">
        <i class="fas fa-spinner fa-spin"></i>
        <span>Checking tone with Gemini AI...</span>
      </div>`;

    // Step 2: Tone check (Gemini - needs key)
    let toneData = null;
    let toneError = null;
    if (apiKey) {
      try {
        toneData = await checkToneWithGemini(resumeText, apiKey);
      } catch (e) {
        toneError = e.message;
      }
    }

    // Render results
    const grammarHtml = grammarIssues.length > 0
      ? `<div class="grammar-issues">
          <h5>📝 Grammar Issues Found (${grammarIssues.length})</h5>
          ${grammarIssues.slice(0, 8).map(issue => `
            <div class="grammar-issue">
              <span class="issue-text">"${issue.context?.text?.slice(
                issue.context.offset,
                issue.context.offset + issue.context.length
              )}"</span>
              <span class="issue-msg">${issue.message}</span>
              ${issue.replacements?.length > 0
                ? `<span class="issue-fix">Suggestion: <strong>${issue.replacements.slice(0,3).map(r=>r.value).join(', ')}</strong></span>`
                : ''}
            </div>`).join('')}
        </div>`
      : `<div class="grammar-ok">✅ No major grammar issues found!</div>`;

    const toneHtml = toneData
      ? `<div class="tone-results">
          <h5>🎯 Tone Analysis (Gemini)</h5>
          <div class="tone-score-row">
            <span class="tone-badge tone-${toneData.tone?.toLowerCase()}">${toneData.tone}</span>
            <span class="tone-score">${toneData.toneScore}/100</span>
          </div>
          <p class="tone-summary">${toneData.summary}</p>
          ${toneData.improvements?.length > 0 ? `
          <div class="tone-improvements">
            <strong>💡 Improvements:</strong>
            <ul>${toneData.improvements.map(i => `<li>${i}</li>`).join('')}</ul>
          </div>` : ''}
          ${toneData.powerVerbs?.length > 0 ? `
          <div class="power-verbs">
            <strong>⚡ Power Verbs to Use:</strong>
            <div class="verb-tags">${toneData.powerVerbs.map(v => `<span class="verb-tag">${v}</span>`).join('')}</div>
          </div>` : ''}
        </div>`
      : toneError
        ? `<div class="tone-error">⚠️ Gemini: ${toneError}<br><small>Add your Gemini API key above to enable tone analysis</small></div>`
        : `<div class="tone-error">ℹ️ Enter your Gemini API key above to enable tone analysis</div>`;

    resultDiv.innerHTML = grammarHtml + toneHtml;

  } catch (err) {
    resultDiv.innerHTML = `<div class="ai-error">❌ Error: ${err.message}</div>`;
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
