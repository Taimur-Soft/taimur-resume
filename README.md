# Taimur Resume

A free, browser-based resume builder with a live preview, 15 Europass-format templates, cloud save, keyword-based ATS scoring, grammar and tone checking, GitHub import, and shareable links with QR codes.

**Live site:** [taimur-resume.vercel.app](https://taimur-resume.vercel.app)

---

## Features

### Building the resume
- **Live split-view preview.** The resume re-renders as you type, next to the form.
- **15 Europass-format templates.** One EU-recognized structure in three layouts and 15 looks:
  - *Sidebar:* Aurora, Emerald, Slate, Coral, Ivory
  - *Banner:* Sunrise, Horizon, Blossom, Nordic, Velvet
  - *Timeline:* Pulse, Meridian, Zenith, Canvas, Quartz
- **Matching accent colours.** Each template sets its own heading, rule and link colour to fit its palette.
- **Guided sections:** personal info, experience, education, skills, projects and achievements, with a sidebar progress tracker.
- **Language skills on the CEFR scale.** Each language is rated A1–C2 for listening, reading, speaking and writing, and mother tongues are listed separately, matching the Europass CV language grid.
- **Custom sections** such as Certifications, Volunteering, Publications or Awards, with one-click presets.
- **Skill suggestions** based on the job title (for example a Frontend Developer is offered React, TypeScript and accessibility), plus four clear skill levels.
- **Writing help:** tips and character counters on longer fields, and cards that title themselves (e.g. "Software Engineer · Google") and can be collapsed.
- **Drag-and-drop ordering** of sections (SortableJS).
- **Field validation** for email, phone and URL, shown on blur without blocking input.

### Smart tools
- **ATS keyword score.** Paste a job description to see what percentage of its keywords appear in your resume, plus a list of missing terms. Instant, and runs entirely in the browser.
- **AI job match.** Google Gemini compares the resume with the job by meaning rather than exact words (so "JS" counts as "JavaScript"), gives a match score, lists what matches and which required skills are missing, and rewrites up to three weak bullet points for that job. It is told never to invent experience: where a number would help, it leaves a placeholder such as `[X%]` for the user to fill in.
- **Grammar check** through the public [LanguageTool](https://languagetool.org) API (no key needed).
- **Tone analysis** through Google Gemini.
- **Improve with AI** on any experience or project description: Gemini rewrites it into 2–4 strong bullet points using only the user's facts, shown as a suggestion to accept or dismiss.
- **No key needed when signed in.** Gemini requests go through a small server function (`api/gemini.js`) that holds the site's key, checks the Supabase session and applies a per-user daily limit. Users can still add their own free key for unlimited use; it is stored only in their browser. Busy or rate-limited requests are retried with exponential backoff and then fall back to a lighter model.
- **GitHub import.** Enter a username to fill in name, bio, location and website, and add up to five top non-fork repositories as projects.

### Accounts and cloud save
- **Email sign-up with a one-time code**, then a password (Supabase Auth).
- **Automatic cloud sync** while signed in, plus a manual *Save to Cloud* button.
- **My Resumes:** keep several resumes, then rename, duplicate, load or delete them.
- **Account menu and settings:** a navbar menu (settings, resumes, AI usage, theme, sign out) and tabbed settings: Profile (photo, name, phone, fill the resume from the profile), Security (password change that checks the current password, strength meter, sign out of all devices), Privacy (GDPR data download and account deletion) and AI (today's usage).
- **Safe sign-out:** unsaved edits are saved first, with an option to remove the Gemini key from a shared computer.
- **Demo mode** for signed-out visitors. Nothing is stored, so no data is left behind on shared computers.

### Export and sharing
- **PDF download** as paginated A4 (html2canvas + jsPDF), with browser print as a fallback.
- **Import from PDF, Word (.docx) or JSON.** PDF and Word text is read in the browser (pdf.js, mammoth.js, loaded only when needed); Gemini sorts it into the builder's sections using only what the file says, and a preview shows what was found before it opens as a new resume. JSON accepts a single exported resume or a full account backup.
- **Export menu:** Word (.docx, clean ATS-friendly layout), plain text, **Europass XML** (SkillsPassport V3.3, for the Europass portal), a stand-alone web page with the chosen template's design, and a JSON backup. Built in the browser (JSZip for Word, loaded only when needed).
- **Private share links.** Signed-in users get a short link (`view.html?r=CODE`) stored in their own Supabase (`supabase/share.sql`): it always shows the latest version, counts views, can hide phone and address, and can be turned off. Signed out, the resume (without the photo) is packed into the link itself with lz-string.
- **Styled QR code** in the template's colour with the person's initials in the middle, verified to scan, downloadable as a print-ready PNG; one-click sharing to WhatsApp, LinkedIn, email and Telegram, plus the phone's own share menu.

---

## Tech stack

| Layer | Technology |
|---|---|
| Front end | HTML5, CSS3, vanilla JavaScript (no framework or build step) |
| Auth, database, file storage | [Supabase](https://supabase.com) (PostgreSQL, Auth, Storage) |
| Serverless API | Vercel Serverless Functions (Node.js) |
| Hosting | [Vercel](https://vercel.com), auto-deployed from `main` |
| AI and language | Google Gemini API, LanguageTool API |
| Libraries | SortableJS, html2canvas, jsPDF, lz-string, qrcode.js, Font Awesome, Google Fonts |

---

## Architecture

```mermaid
flowchart LR
  U[Browser] -->|static pages| V[Vercel CDN]
  U -->|auth, resumes, avatars| S[(Supabase)]
  U -->|share link| F[/api/shorten/]
  F -->|shorten| G[is.gd]
  U -->|grammar| L[LanguageTool API]
  U -->|AI, signed in| AI[/api/gemini/]
  AI -->|site key, daily limit| GM[Google Gemini API]
  U -->|AI, user's own key| GM
  U -->|profile and repos| GH[GitHub API]
```

Most of the app runs in the browser. The server code is two small functions:

- `api/shorten.js` proxies is.gd to avoid CORS errors and accepts only `http`/`https` URLs, so it cannot be used as an open proxy.
- `api/gemini.js` calls Gemini with the site's key for signed-in users. It verifies the Supabase session, counts each request against a daily limit (`supabase/ai-usage.sql`), and only forwards plain text prompts to two allowed models.

---

## Project structure

```
├── index.html              Landing page
├── resume.html             The builder (form, preview, modals)
├── view.html               Read-only page for shared resume links
├── api/
│   ├── gemini.js           Gemini proxy for signed-in users (site key, daily limit)
│   └── shorten.js          Serverless URL shortener (is.gd proxy)
├── supabase/
│   ├── ai-usage.sql        Daily AI usage counter (run once in Supabase)
│   ├── account.sql         AI usage lookup and "delete my account" (run once)
│   └── share.sql           Short private share links (run once)
├── assets/
│   ├── css/main.css        App and template styles
│   └── js/
│       ├── app.js          Form state, live preview, templates, JSON import/export
│       ├── auth.js         Sign-up/sign-in, cloud save, My Resumes, account settings
│       ├── ai-tools.js     ATS keyword score, AI job match, grammar and tone checks
│       ├── github-import.js
│       ├── resume-import.js  Import from PDF / Word / JSON (AI sorts the text into sections)
│       ├── resume-export.js  Export to Word / text / Europass XML / HTML / JSON
│       ├── pdf-export.js
│       ├── share.js        Link compression, shortening, QR code
│       └── supabase-config.js
└── vercel.json
```

---

## Running locally

1. Clone the repository:
   ```bash
   git clone https://github.com/Taimur-Soft/taimur-resume.git
   cd taimur-resume
   ```
2. Serve the folder with any static server, for example:
   ```bash
   npx serve .
   ```
3. To run the URL-shortener function locally as well, use the Vercel CLI instead:
   ```bash
   npx vercel dev
   ```

Without the function, sharing still works: the app falls back to the full-length link.

### Supabase setup (for your own instance)

Put your project URL and anon key in `assets/js/supabase-config.js`, then create:

- a **`resumes`** table with `id`, `user_id` (references `auth.users`), `name` (text), `data` (jsonb) and `updated_at` (timestamptz);
- Row Level Security policies so each user can only read and write their own rows;
- a public **`avatars`** storage bucket for profile photos.

Email sign-up uses Supabase's one-time code (OTP) emails, so enable email OTP in the Auth settings.

### Shared AI key (optional)

1. Run `supabase/ai-usage.sql` once in the Supabase SQL Editor (creates the daily usage counter).
2. In Vercel → Project → Settings → Environment Variables, add `GEMINI_API_KEY` (a key from [aistudio.google.com](https://aistudio.google.com/apikey)) and optionally `AI_DAILY_LIMIT` (default 30), then redeploy.

Without these, the AI tools still work for anyone who adds their own key.

### Account page (optional)

Run `supabase/account.sql` once in the SQL Editor (after `ai-usage.sql`). It adds "AI usage today" and the GDPR "Delete my account" option to Account Settings.

### Share links (optional)

Run `supabase/share.sql` once in the SQL Editor. Until then, sharing falls back to links that carry the resume (without the photo).

---

## Security and privacy

- **XSS protection.** Resume data can arrive from untrusted shared links, so every field is HTML-escaped before rendering. Links are limited to `http`, `https` and `mailto`, and images to `https` or local `data:image` URLs.
- **No leftover local data.** Resumes are never kept in `localStorage`; signed-out sessions start blank, and data from older versions is purged on load.
- **Keys stay secret.** The site's Gemini key exists only as a Vercel environment variable and never reaches the browser. A user's own key is stored only in their browser and sent only to Google.
- **No contact details sent to AI.** Email and phone number are left out of everything sent to LanguageTool and Gemini.
- **Share links stay private.** Short links live in the owner's own database; visitors can only read a resume through a function that checks the link is still active (Row Level Security keeps the table itself closed). No third party receives the resume, except the URL shortener in the rare signed-out case where a link is too long for a QR code.

---

## Author

**Taimur Rahman**, university final-year project.

© Taimur Rahman Org. All rights reserved.
