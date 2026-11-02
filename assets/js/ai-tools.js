// ======================================================
// AI Tools Module
// 1. ATS Score — client-side keyword matching (free)
// 2. Grammar Checker — LanguageTool public API (no key)
// 3. Tone Checker — Google Gemini, through the site's server (api/gemini.js)
// 4. AI Match Analysis — Gemini compares resume and job by meaning
// 5. Improve with AI — Gemini rewrites one description into bullet points
// All Gemini requests go through api/gemini.js; the browser never has a key.
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

  // Job keywords (normalised) → how often each appears and how it was written.
  const jobCounts = new Map();
  const jobDisplay = new Map();
  extractATSKeywords(jobDesc).forEach(({ key, word }) => {
    jobCounts.set(key, (jobCounts.get(key) || 0) + 1);
    if (!jobDisplay.has(key)) jobDisplay.set(key, word);
  });
  const resumeWordSet = new Set(extractATSKeywords(resumeText).map(k => k.key));

  const jobKeywords = [...jobCounts.keys()];
  const matched = jobKeywords.filter(kw => resumeWordSet.has(kw));
  // Most-mentioned missing terms first: those matter most to this job.
  const missing = jobKeywords
    .filter(kw => !resumeWordSet.has(kw))
    .sort((a, b) => jobCounts.get(b) - jobCounts.get(a))
    .slice(0, 15)
    .map(kw => jobDisplay.get(kw));

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
            ${missing.map(w => `<span class="missing-tag">${escapeHTML(w)}</span>`).join('')}
          </div>
        </div>` : '<div class="ats-stat">🎉 All key terms matched!</div>'}
      </div>
    </div>
  `;
}

// Words that appear in almost every job ad but say nothing about the skills
// wanted. Counting them made the score low and the "Consider adding" list
// useless ("looking", "years", "closely"...).
const ATS_STOP_WORDS = new Set(`
a about above across after again all also am an and any are as at be been being both but by can could did do does
doing during each etc every few for from further had has have having he her here hers him his how i if in into is it
its just like may me might more most must my no nor not now of off on once only or other our ours out over own per
same shall she should so some such than that the their them then there these they this those through to too under
until up upon very via was we well were what when where which while who whom why will with within without would yes
you your yours
ability able abilities additional apply applicant applicants apply candidate candidates closely company day days
desired duties ensure environment equal excellent exciting experience experienced experiences familiar familiarity
following full good great help highly ideal ideally including job join key knowledge least level looking make minimum
months new nice offer offers opportunity opportunities plus position preferred proven related required requirement
requirements responsibilities responsibility responsible role salary similar strong successful team teams time understanding using
want way week weeks work working works year years skill skilled solid hands modern field member based duty seeking
fast-paced paced dynamic passionate motivated plus etc`.split(/\s+/).filter(Boolean));

// Short tokens that are real skills, not noise.
const ATS_SHORT_TERMS = new Set(['ai', 'ml', 'ui', 'ux', 'qa', 'go', 'bi', 'ci', 'cd', 'c', 'r', '3d', 'ar', 'vr', 'ios', 'aws', 'gcp', 'sql', 'css', 'php', 'api', 'seo', 'git']);

// Different spellings of the same thing count as one keyword.
const ATS_ALIASES = {
  js: 'javascript', ts: 'typescript', reactjs: 'react', 'react.js': 'react', nodejs: 'node', 'node.js': 'node',
  'vue.js': 'vue', vuejs: 'vue', 'next.js': 'nextjs', 'nest.js': 'nestjs', postgres: 'postgresql', k8s: 'kubernetes',
  'c#': 'csharp', golang: 'go', apis: 'api', restful: 'rest', html5: 'html', css3: 'css', 'es6+': 'es6', ml: 'machine-learning'
};

// Returns [{key, word}]: key is used for matching (lower case, alias and
// plural folded), word is how it was written, for display.
function extractATSKeywords(text) {
  return text
    .replace(/[^A-Za-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter(Boolean)
    .map(word => {
      let key = word.toLowerCase();
      if (ATS_ALIASES[key]) return { key: ATS_ALIASES[key], word };
      if (key.length > 4 && key.endsWith('ies')) key = key.slice(0, -3) + 'y';
      else if (key.length > 3 && key.endsWith('s') && !/(ss|us|is|js)$/.test(key)) key = key.slice(0, -1);
      return { key: ATS_ALIASES[key] || key, word };
    })
    .filter(({ key }) => (key.length > 2 || ATS_SHORT_TERMS.has(key)) && !ATS_STOP_WORDS.has(key) && !/^\d+$/.test(key));
}

// Helper: get the resume's own text as a single string.
// Built from collectFormData() so it only contains resume content. Reading
// every .form-input on the page would also pick up the job description
// (making every ATS keyword "match") and any sign-in or account fields,
// and send them to LanguageTool and Gemini.
function getResumeText() {
  const data = collectFormData();
  // Contact details (email, phone) aren't needed by any check, so they are
  // never sent to LanguageTool or Gemini.
  const skipKeys = new Set(['image', 'level', 'link', 'current', 'email', 'phoneno']);
  const parts = [];
  const walk = (value) => {
    if (typeof value === 'string') { if (value.trim()) parts.push(value.trim()); }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value)) if (!skipKeys.has(key)) walk(v);
    }
  };
  walk([data.personal, data.experiences, data.educations, data.skills,
        data.projects, data.achievements, (data.languages || []).map(l => l.language),
        data.customSections]);
  return parts.join('\n');
}

// Only the sentences people write (summary and descriptions), one paragraph
// each, for the grammar check. Names, titles and companies are left out:
// LanguageTool flagged them as spelling mistakes, and gluing separate
// fields together produced fake "repeated word" errors.
function getResumeProse() {
  const d = collectFormData();
  const texts = [
    d.personal.summary,
    ...d.experiences.map(e => e.description),
    ...d.educations.map(e => e.description),
    ...d.projects.map(p => p.description),
    ...d.achievements.map(a => a.description),
    ...d.customSections.flatMap(s => s.items.map(i => i.description))
  ];
  return texts
    .map(t => (t || '').replace(/^[\s•\-*]+/gm, '').trim())
    .filter(Boolean)
    .map(t => /[.!?]$/.test(t) ? t : t + '.')
    .join('\n\n');
}

// Names, companies, schools, skills and titles from the resume, so a
// "possible spelling mistake" on one of them can be ignored.
function getResumeProperTerms() {
  const d = collectFormData();
  const words = [
    d.personal.firstname, d.personal.middlename, d.personal.lastname, d.personal.designation, d.personal.address,
    ...d.experiences.flatMap(e => [e.title, e.organization, e.location]),
    ...d.educations.flatMap(e => [e.school, e.degree, e.city]),
    ...d.skills.map(s => s.skill),
    ...d.projects.map(p => p.title),
    ...d.achievements.map(a => a.title)
  ].join(' ').toLowerCase().split(/[^a-z0-9+#.]+/);
  return new Set(words.filter(Boolean));
}


// ── 2. GRAMMAR CHECKER (LanguageTool) ─────────────────
// Returns { issues, error }. A failed request is reported as an error
// instead of silently showing "no grammar issues".
async function checkGrammar(text) {
  if (!text || text.length < 10) return { issues: [], error: null };

  try {
    const response = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // The free API accepts up to 20 KB per request.
      body: `text=${encodeURIComponent(text.slice(0, 15000))}&language=en-US`
    });
    if (!response.ok) {
      return { issues: [], error: response.status === 429
        ? 'LanguageTool is busy (too many checks this minute). Try again shortly.'
        : `LanguageTool returned an error (${response.status}).` };
    }
    const data = await response.json();
    const known = getResumeProperTerms();
    const issues = (data.matches || []).filter(m => {
      if (m.rule?.issueType !== 'misspelling') return true;
      const word = (m.context?.text || '').slice(m.context.offset, m.context.offset + m.context.length);
      // Skip names, companies and tech terms the user wrote elsewhere, and
      // capitalised words in general (most are proper nouns or products).
      return !known.has(word.toLowerCase()) && !/^[A-Z]/.test(word);
    });
    return { issues, error: null };
  } catch (err) {
    console.warn('LanguageTool error:', err);
    return { issues: [], error: 'Could not reach LanguageTool. Check your internet connection.' };
  }
}


// ── 3. TONE CHECKER (Google Gemini) ───────────────────
class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// All AI requests go through the site's own server (api/gemini.js). Only
// the server knows the Gemini key (set by the site owner on Vercel); it
// checks the user is signed in, applies the daily limit, and does the
// retries and model fallbacks itself. Users never see or enter a key.
// onStatus(text) lets the caller show progress while it waits.
async function callGeminiWithRetry(body, onStatus = () => {}) {
  let token = null;
  try {
    const { data } = await supabaseClient.auth.getSession();
    token = data?.session?.access_token || null;
  } catch (e) { /* treated as signed out below */ }
  if (!token) {
    const err = new GeminiError('Please sign in to use the AI tools.', 401);
    err.site = true;
    throw err;
  }

  onStatus('Asking Gemini (this can take up to a minute when it is busy)...');
  let response;
  try {
    response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new GeminiError('Could not reach the AI service. Check your internet connection.', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallbackMsg = response.status === 504
      ? 'The AI took too long to answer. Please try again; it is usually faster the second time.'
      : `AI service error (${response.status}). Please try again.`;
    const err = new GeminiError(data.error || fallbackMsg, response.status);
    err.site = true;
    err.code = data.code;
    err.details = data.details || '';
    throw err;
  }
  if (data.usage) siteAIUsage = data.usage;
  return data;
}

let siteAIUsage = null; // { used, limit } from the last AI request today (shown in the account menu)

// The server already writes a complete, user-facing message; this adds
// its technical details line, if any.
function geminiErrorHint(status, err) {
  if (err?.site) return err.details ? `Details: ${err.details}` : '';
  return 'Please try again.';
}

async function checkToneWithGemini(text, onStatus) {
  const prompt = `You are a professional resume writing expert. Analyze the following resume content and provide:
1. Overall tone assessment (Professional/Casual/Weak/Strong)
2. Top 3 specific improvements for tone and impact
3. Flag any passive voice sentences
4. Suggest 2-3 power verbs to replace weak words
5. Find up to 5 grammar mistakes (e.g. subject-verb agreement, wrong tense, missing articles). Ignore names, company names, technical terms and resume-style fragments without a subject, which are normal on a resume.

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
  "grammarFixes": [{"original": "exact phrase from the resume", "corrected": "corrected phrase"}],
  "summary": "One sentence overall assessment"
}`;

  const data = await callGeminiWithRetry({
    contents: [{ parts: [{ text: prompt }] }],
    // Newer models spend part of the token budget on internal reasoning,
    // so 1024 tokens could cut the JSON answer off midway.
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } }
  }, onStatus);

  return parseGeminiJSON(data);
}

// Pulls the JSON object out of a Gemini response.
function parseGeminiJSON(data) {
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse Gemini response');
  return JSON.parse(jsonMatch[0]);
}


// ── 4. AI MATCH ANALYSIS (Gemini) ─────────────────────
// The keyword score above only counts exact word matches. This asks Gemini
// to compare meaning instead ("JS" = "JavaScript", "led a team" = "people
// management"), name the skills that are really missing, and rewrite weak
// bullet points for this specific job.
async function analyzeJobMatchWithGemini(resumeText, jobDesc, onStatus) {
  const prompt = `You are an experienced recruiter and ATS (applicant tracking system) expert.
Compare the candidate's resume with the job description and judge how well they fit, based on meaning rather than exact wording. Treat synonyms, abbreviations and related technologies as matches (for example "JS" and "JavaScript", "Postgres" and "PostgreSQL").

Rules:
- Only use facts that appear in the resume. Never invent experience, employers, numbers or skills.
- In rewritten bullets, where a number would make the point stronger but the resume gives none, write a placeholder in square brackets such as [X%] or [number of users] for the candidate to fill in.
- Rewrite at most 3 bullets, choosing the weakest sentences from the resume that matter most for this job. Use a strong action verb and show impact.
- Keep every string short and specific.

Resume:
"""
${resumeText.slice(0, 6000)}
"""

Job description:
"""
${jobDesc.slice(0, 6000)}
"""

Respond only with JSON in exactly this shape:
{
  "matchScore": 0-100 integer,
  "verdict": "Strong match" | "Good match" | "Partial match" | "Weak match",
  "summary": "Two sentences on overall fit",
  "matchedSkills": [{"job": "requirement as written in the job", "resume": "matching evidence from the resume"}],
  "missingSkills": [{"skill": "important requirement not shown in the resume", "importance": "required" | "nice to have"}],
  "bulletRewrites": [{"original": "sentence from the resume", "improved": "rewritten version"}],
  "tips": ["short, specific tip", "..."]
}`;

  const data = await callGeminiWithRetry({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' }
  }, onStatus);

  return parseGeminiJSON(data);
}

async function checkATSWithAI() {
  const jobDesc = document.getElementById('jobDescription').value.trim();
  if (!jobDesc) {
    showToast('Please paste a job description first', 'error');
    return;
  }
  const resumeText = getResumeText();
  if (resumeText.length < 50) {
    showToast('Please fill in more of your resume first', 'error');
    return;
  }
  if (!canUseSiteAI()) {
    showToast('Please sign in to use the AI tools', 'error');
    return;
  }

  const btn = document.getElementById('atsAiBtn');
  const resultDiv = document.getElementById('atsAiResult');
  const showLoading = (message) => {
    resultDiv.innerHTML = `
      <div class="ai-loading">
        <i class="fas fa-spinner fa-spin"></i>
        <span>${escapeHTML(message)}</span>
      </div>`;
  };
  resultDiv.style.display = 'block';
  showLoading('Gemini is comparing your resume with the job...');
  if (btn) btn.disabled = true;

  try {
    const result = await analyzeJobMatchWithGemini(resumeText, jobDesc, showLoading);
    resultDiv.innerHTML = renderAIMatch(result);
  } catch (e) {
    resultDiv.innerHTML = `<div class="tone-error">⚠️ ${escapeHTML(e.message)}<br><small>${escapeHTML(geminiErrorHint(e.status, e))}</small></div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderAIMatch(r) {
  const list = (v) => Array.isArray(v) ? v : [];
  const score = Math.max(0, Math.min(100, Math.round(Number(r.matchScore) || 0)));
  const color = score >= 70 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  const matched = list(r.matchedSkills).slice(0, 12);
  const missing = list(r.missingSkills).slice(0, 10);
  const rewrites = list(r.bulletRewrites).slice(0, 3);
  const tips = list(r.tips).slice(0, 5);

  return `
    <div class="ai-match">
      <div class="ats-score-display">
        <div class="ats-score-circle" style="border-color:${color}; color:${color}">
          <span class="ats-score-num">${score}%</span>
          <span class="ats-score-lbl">AI Match</span>
        </div>
        <div class="ats-score-details">
          <div class="ats-label" style="color:${color}">${escapeHTML(r.verdict || '')}</div>
          <p class="ai-match-summary">${escapeHTML(r.summary || '')}</p>
        </div>
      </div>

      ${matched.length ? `
      <div class="ai-match-block">
        <h5>✅ What matches</h5>
        <ul class="ai-match-list">
          ${matched.map(m => `<li><strong>${escapeHTML(m.job)}</strong><span>${escapeHTML(m.resume)}</span></li>`).join('')}
        </ul>
      </div>` : ''}

      ${missing.length ? `
      <div class="ai-match-block">
        <h5>⚡ Missing from your resume</h5>
        <div class="missing-tags">
          ${missing.map(m => `<span class="missing-tag${m.importance === 'required' ? ' missing-tag-required' : ''}" title="${escapeHTML(m.importance || '')}">${escapeHTML(m.skill)}${m.importance === 'required' ? ' · required' : ''}</span>`).join('')}
        </div>
        <p class="hint-text" style="margin-top:6px">Only add these if you really have the skill.</p>
      </div>` : ''}

      ${rewrites.length ? `
      <div class="ai-match-block">
        <h5>✍️ Stronger bullet points</h5>
        ${rewrites.map(b => `
          <div class="ai-rewrite">
            <div class="ai-rewrite-before"><span>Before</span>${escapeHTML(b.original)}</div>
            <div class="ai-rewrite-after"><span>After</span>${escapeHTML(b.improved)}</div>
          </div>`).join('')}
        <p class="hint-text" style="margin-top:6px">Replace anything in [brackets] with your real numbers.</p>
      </div>` : ''}

      ${tips.length ? `
      <div class="ai-match-block">
        <h5>💡 Tips for this job</h5>
        <ul class="ai-match-tips">${tips.map(t => `<li>${escapeHTML(t)}</li>`).join('')}</ul>
      </div>` : ''}
    </div>`;
}


// ── 5. IMPROVE ONE DESCRIPTION (Gemini) ───────────────
// "Improve with AI" under each experience / project description. Rewrites
// what the user wrote into 2–4 strong bullet points, using only their
// facts, and shows it as a suggestion they can accept or dismiss.
async function improveDescription(btn) {
  const elem = btn.closest('.form-elem');
  const field = elem.querySelector('textarea');
  const item = btn.closest('.repeater-item');
  const box = elem.querySelector('.ai-suggest');
  const text = field.value.trim();

  if (text.length < 10) {
    showToast('Write a few words about it first, then let AI polish them', 'error');
    field.focus();
    return;
  }
  if (!canUseSiteAI()) {
    showToast('Please sign in to use AI', 'error');
    return;
  }

  const val = cls => item.querySelector(`.${cls}`)?.value.trim() || '';
  const context = item.dataset.section === 'projects'
    ? `a project called "${val('proj_title') || 'untitled'}"`
    : `a role as "${val('exp_title') || 'unknown title'}" at "${val('exp_organization') || 'unknown company'}"`;

  const prompt = `You are an expert resume writer. Rewrite this description of ${context} into 2 to 4 resume bullet points.

Rules:
- Use only facts that appear in the text. Never invent employers, tools, numbers or results.
- Start each bullet with a strong past-tense action verb (Built, Led, Reduced...).
- Where a number would make the impact clearer but none is given, add a placeholder in square brackets, e.g. [X%] or [number of users].
- Keep each bullet under 25 words. No bullet symbols, no trailing full stops.

Text:
"""
${text.slice(0, 1500)}
"""

Respond only with JSON: {"bullets": ["...", "..."]}`;

  // Loading line with a live seconds counter, so the wait feels shorter
  // and the user can see it hasn't stalled.
  const started = Date.now();
  let message = 'Rewriting with Gemini...';
  const paint = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    box.innerHTML = `<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i><span>${escapeHTML(message)}</span><span class="ai-elapsed">${secs}s</span></div>`;
  };
  const setLoading = (text) => { message = text; paint(); };
  const ticker = setInterval(paint, 1000);
  btn.disabled = true;
  paint();

  try {
    const data = await callGeminiWithRetry({
      contents: [{ parts: [{ text: prompt }] }],
      // A short rewrite needs little reasoning; "low" thinking answers much
      // faster than the model's default ("medium").
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } }
    }, setLoading);
    const bullets = (parseGeminiJSON(data).bullets || [])
      .map(b => String(b).replace(/^[\s•\-*]+/, '').trim())
      .filter(Boolean)
      .slice(0, 4);
    if (!bullets.length) throw new Error('Gemini did not return any bullet points');

    box.innerHTML = `
      <div class="ai-suggest-card">
        <div class="ai-suggest-head"><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i> Suggested rewrite</div>
        <ul>${bullets.map(b => `<li>${escapeHTML(b)}</li>`).join('')}</ul>
        <p class="hint-text">Replace anything in [brackets] with your real numbers, or delete it.</p>
        <div class="ai-suggest-actions">
          <button type="button" class="btn-primary ai-use">Use this</button>
          <button type="button" class="btn-icon ai-dismiss">Dismiss</button>
        </div>
      </div>`;
    box.querySelector('.ai-use').addEventListener('click', () => {
      field.value = bullets.map(b => `• ${b}`).join('\n');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      box.innerHTML = '';
      generateCV();
      showToast('✅ Description updated', 'success');
    });
    box.querySelector('.ai-dismiss').addEventListener('click', () => { box.innerHTML = ''; });
  } catch (e) {
    clearInterval(ticker);
    box.innerHTML = `<div class="tone-error">⚠️ ${escapeHTML(e.message)}<br><small>${escapeHTML(geminiErrorHint(e.status, e))}</small></div>`;
  } finally {
    clearInterval(ticker);
    btn.disabled = false;
  }
}


// ── COMBINED: Grammar + Tone ───────────────────────────
async function checkGrammarAndTone() {
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
    // Step 1: Grammar check (LanguageTool - free, no key), on the written
    // sentences only.
    const { issues: grammarIssues, error: grammarError } = await checkGrammar(getResumeProse());

    const showLoading = (message) => {
      resultDiv.innerHTML = `
        <div class="ai-loading">
          <i class="fas fa-spinner fa-spin"></i>
          <span>${escapeHTML(message)}</span>
        </div>`;
    };
    showLoading('Checking tone with Gemini AI...');

    // Step 2: Tone check (Gemini, through api/gemini.js; needs sign-in)
    let toneData = null;
    let toneError = null;
    let toneErrorHint = '';
    if (canUseSiteAI()) {
      try {
        toneData = await checkToneWithGemini(resumeText, showLoading);
      } catch (e) {
        toneError = e.message;
        toneErrorHint = geminiErrorHint(e.status, e);
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
      : grammarError
        ? `<div class="tone-error">⚠️ Grammar check: ${escapeHTML(grammarError)}</div>`
        : `<div class="grammar-ok">✅ LanguageTool found no grammar or spelling issues.</div>`;

    // Gemini catches mistakes LanguageTool misses (e.g. "who have built").
    const fixes = (Array.isArray(toneData?.grammarFixes) ? toneData.grammarFixes : [])
      .filter(f => f && f.original && f.corrected && f.original.trim() !== f.corrected.trim())
      .slice(0, 5);
    const fixesHtml = fixes.length ? `
      <div class="grammar-issues">
        <h5>✏️ More grammar fixes (Gemini)</h5>
        ${fixes.map(f => `
          <div class="grammar-issue">
            <span class="issue-text">"${escapeHTML(f.original)}"</span>
            <span class="issue-fix">Suggestion: <strong>${escapeHTML(f.corrected)}</strong></span>
          </div>`).join('')}
      </div>` : '';

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
        : `<div class="tone-error">ℹ️ Sign in to get the AI tone analysis too</div>`;

    resultDiv.innerHTML = grammarHtml + fixesHtml + toneHtml;

  } catch (err) {
    resultDiv.innerHTML = `<div class="ai-error">❌ Error: ${escapeHTML(err.message)}</div>`;
  }
}

// Signed-in users can use the AI tools (through api/gemini.js).
function canUseSiteAI() {
  return typeof currentUser !== 'undefined' && !!currentUser;
}

// Older versions let users save their own Gemini key in the browser.
// That option is gone, so forget any key left over from then.
try { localStorage.removeItem('geminiApiKey'); } catch (e) {}
