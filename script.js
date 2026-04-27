// ─── Config ──────────────────────────────────────────────────────────────────

const API = {
  getEvents: '/get-daily-events',
  submitRatings: '/submit-ratings',
};

// Fallback sample data for offline development / demo
const SAMPLE_EVENTS = [
  {
    id: 'evt-001',
    title: 'AI in Healthcare Summit 2026',
    org: 'MedTech Alliance',
    date: '2026-05-14',
    tags: ['AI', 'Healthcare', 'Summit'],
    ai_score: 5,
    ai_reason: 'Directly aligns with your interest in AI applications and healthcare innovation. Keynote includes case studies from three leading hospital networks.',
    link: 'https://example.com/ai-health-summit',
  },
  {
    id: 'evt-002',
    title: 'Open Source Security Conference',
    org: 'Linux Foundation',
    date: '2026-05-20',
    tags: ['Security', 'Open Source', 'DevOps'],
    ai_score: 4,
    ai_reason: 'Strong overlap with software engineering and security topics you\'ve engaged with recently. Includes a workshop on supply-chain security.',
    link: 'https://example.com/oss-security',
  },
  {
    id: 'evt-003',
    title: 'Product-Led Growth Masterclass',
    org: 'Reforge',
    date: '2026-05-22',
    tags: ['Product', 'Growth', 'SaaS'],
    ai_score: 4,
    ai_reason: 'Matches your product strategy interests. Covers activation loops and retention frameworks used by top SaaS companies.',
    link: 'https://example.com/plg-masterclass',
  },
  {
    id: 'evt-004',
    title: 'Generative Art & Creative Coding Workshop',
    org: 'Creative Code NYC',
    date: '2026-05-18',
    tags: ['Creative', 'Generative AI', 'Art'],
    ai_score: 2,
    ai_reason: 'Exploratory pick — adjacent to your technical background but outside your usual domain. Useful for broadening perspective on creative AI use cases.',
    link: 'https://example.com/genart-workshop',
  },
  {
    id: 'evt-005',
    title: 'Climate Tech Investor Briefing',
    org: 'GreenVC Network',
    date: '2026-05-25',
    tags: ['Climate', 'Investment', 'Startups'],
    ai_score: 2,
    ai_reason: 'Low-signal exploratory event. Included to surface emerging trends outside your current focus area that may become relevant.',
    link: 'https://example.com/climate-vc',
  },
];

// ─── State ────────────────────────────────────────────────────────────────────

// ratings[eventId] = { user_rating: number|null, user_feedback: string }
const ratings = {};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $loading     = document.getElementById('loading');
const $error       = document.getElementById('error');
const $errorMsg    = document.getElementById('error-message');
const $retryBtn    = document.getElementById('retry-btn');
const $eventsList  = document.getElementById('events-list');
const $submitSect  = document.getElementById('submit-section');
const $submitBtn   = document.getElementById('submit-btn');
const $submitHint  = document.getElementById('submit-hint');
const $confirm     = document.getElementById('confirmation');

// ─── Init ─────────────────────────────────────────────────────────────────────

$retryBtn.addEventListener('click', loadEvents);
$submitBtn.addEventListener('click', handleSubmit);

loadEvents();

// ─── Data fetching ────────────────────────────────────────────────────────────

async function loadEvents() {
  show($loading);
  hide($error);
  hide($eventsList);
  hide($submitSect);

  let events;

  try {
    const res = await fetch(API.getEvents);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    events = await res.json();
  } catch (err) {
    // In production remove the fallback and surface the error.
    // For local development, fall through to sample data.
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') {
      console.warn('API unavailable — using sample data for development.', err.message);
      events = SAMPLE_EVENTS;
    } else {
      showError('Could not load today\'s events. Check your connection and try again.');
      return;
    }
  }

  hide($loading);
  renderEvents(events);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderEvents(events) {
  $eventsList.innerHTML = '';

  events.forEach((event, index) => {
    // Initialise state slot
    ratings[event.id] = { user_rating: null, user_feedback: '' };

    const card = buildCard(event, index);
    $eventsList.appendChild(card);
  });

  show($eventsList);
  show($submitSect);
  updateSubmitState();
}

function buildCard(event, index) {
  const card = document.createElement('article');
  card.className = 'event-card';
  card.dataset.eventId = event.id;

  // Format date for display
  const displayDate = formatDate(event.date);

  // Build tags HTML
  const tagsHtml = event.tags
    .map(t => `<span class="tag">${escHtml(t)}</span>`)
    .join('');

  card.innerHTML = `
    <div class="card-header">
      <h2 class="card-title">${escHtml(event.title)}</h2>
      <span class="ai-score-badge">AI Score: ${event.ai_score}/5</span>
    </div>

    <div class="card-meta">
      <span>${escHtml(event.org)}</span>
      <span>${displayDate}</span>
    </div>

    <div class="card-tags">${tagsHtml}</div>

    <p class="ai-reason">${escHtml(event.ai_reason)}</p>

    <a class="card-link" href="${escAttr(event.link)}" target="_blank" rel="noopener noreferrer">
      View Event ↗
    </a>

    <div class="card-divider"></div>

    <div class="rating-section">
      <p class="rating-label">Your Rating</p>
      <div class="stars" role="group" aria-label="Rate this event">
        ${buildStars(event.id)}
      </div>
    </div>

    <div class="feedback-section">
      <textarea
        class="feedback-textarea"
        placeholder="Optional: why is this relevant or not?"
        aria-label="Feedback for ${escAttr(event.title)}"
        rows="2"
      ></textarea>
    </div>
  `;

  // Star interaction
  const starsEl = card.querySelector('.stars');
  attachStarListeners(starsEl, event.id);

  // Feedback interaction
  const textarea = card.querySelector('.feedback-textarea');
  textarea.addEventListener('input', () => {
    ratings[event.id].user_feedback = textarea.value;
  });

  return card;
}

function buildStars(eventId) {
  return [1, 2, 3, 4, 5].map(n => `
    <span
      class="star"
      data-value="${n}"
      data-event="${eventId}"
      role="radio"
      aria-label="${n} star${n > 1 ? 's' : ''}"
      tabindex="0"
    >★</span>
  `).join('');
}

// ─── Star interaction ─────────────────────────────────────────────────────────

function attachStarListeners(starsEl, eventId) {
  const stars = starsEl.querySelectorAll('.star');

  stars.forEach(star => {
    const val = parseInt(star.dataset.value, 10);

    // Click
    star.addEventListener('click', () => {
      ratings[eventId].user_rating = val;
      paintStars(starsEl, val, val);
      updateSubmitState();
    });

    // Keyboard
    star.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ratings[eventId].user_rating = val;
        paintStars(starsEl, val, val);
        updateSubmitState();
      }
    });

    // Hover preview
    star.addEventListener('mouseenter', () => {
      const selected = ratings[eventId].user_rating;
      paintStars(starsEl, selected, val);
    });
  });

  starsEl.addEventListener('mouseleave', () => {
    const selected = ratings[eventId].user_rating;
    paintStars(starsEl, selected, null);
  });
}

// Paint stars: selected = committed value, hovered = preview value
function paintStars(starsEl, selected, hovered) {
  const stars = starsEl.querySelectorAll('.star');
  const threshold = hovered !== null ? hovered : (selected || 0);

  stars.forEach(star => {
    const val = parseInt(star.dataset.value, 10);
    star.classList.toggle('selected', selected !== null && val <= selected);
    star.classList.toggle('hovered', hovered !== null && val <= hovered && val > (selected || 0));
  });
}

// ─── Submit state ─────────────────────────────────────────────────────────────

function updateSubmitState() {
  const ratedCount = Object.values(ratings).filter(r => r.user_rating !== null).length;
  const total = Object.keys(ratings).length;
  const allRated = total > 0 && ratedCount === total;

  $submitBtn.disabled = !allRated;
  $submitHint.textContent = allRated
    ? 'All events rated — ready to submit.'
    : `Rate all ${total} events to submit. (${ratedCount}/${total} done)`;
}

// ─── Submission ───────────────────────────────────────────────────────────────

async function handleSubmit() {
  $submitBtn.disabled = true;
  $submitBtn.textContent = 'Submitting…';

  const payload = Object.entries(ratings).map(([event_id, data]) => ({
    event_id,
    user_rating: data.user_rating,
    user_feedback: data.user_feedback.trim(),
  }));

  try {
    const res = await fetch(API.submitRatings, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showConfirmation();
  } catch (err) {
    // Surface the error inline without losing the user's ratings
    $submitBtn.disabled = false;
    $submitBtn.textContent = 'Submit Today\'s Ratings';
    $submitHint.textContent = 'Submission failed — please try again.';
    console.error('Submit error:', err);
  }
}

function showConfirmation() {
  hide($eventsList);
  hide($submitSect);
  show($confirm);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function showError(msg) {
  hide($loading);
  $errorMsg.textContent = msg;
  show($error);
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// Prevent XSS from API-supplied strings
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escAttr(str) {
  // Strip javascript: URIs and other dangerous schemes
  const safe = String(str).trim();
  if (/^javascript:/i.test(safe) || /^data:/i.test(safe)) return '#';
  return escHtml(safe);
}
