// ─── Configuration ────────────────────────────────────────────────────────────
// Deploy this file in Google Apps Script (script.google.com) bound to your
// Google Sheet. Set CLAUDE_API_KEY in Project Settings > Script Properties.

const SHEET_NAME = 'Events';
const SPREADSHEET_ID = '';   // ← paste your Google Sheet ID here (from its URL)
const OPENAI_MODEL = 'gpt-4o';
const GMAIL_SEARCH_DAYS = 1;   // how many days back to scan for forwarded emails
const MAX_EVENTS_SHOWN = 5;    // top N events to surface to the UI each day

// Column indices (1-based) — must match your sheet header row exactly:
// ID | Date Found | Event Date | Source | Org | Title | Snippet | Link |
// AI Score | AI Reason | AI Tags | AI Suggested Action | Shown Today? |
// User Star Rating | User Feedback | Final Status
const COL = {
  ID:                   1,
  DATE_FOUND:           2,
  EVENT_DATE:           3,
  SOURCE:               4,
  ORG:                  5,
  TITLE:                6,
  SNIPPET:              7,
  LINK:                 8,
  AI_SCORE:             9,
  AI_REASON:           10,
  AI_TAGS:             11,
  AI_SUGGESTED_ACTION: 12,
  SHOWN_TODAY:         13,
  USER_STAR_RATING:    14,
  USER_FEEDBACK:       15,
  FINAL_STATUS:        16,
};

// ─── Main entry points ────────────────────────────────────────────────────────

/**
 * Runs daily via time-based trigger.
 * Scans Gmail for forwarded emails, extracts events via Claude, writes to sheet.
 */
function fetchAndProcessEmails() {
  const apiKey = getOpenAIApiKey();
  const sheet  = getOrCreateSheet();
  const seenIds = getExistingIds(sheet);

  const threads = searchForwardedThreads();
  Logger.log(`Found ${threads.length} forwarded thread(s).`);

  let added = 0;
  for (const thread of threads) {
    const messages = thread.getMessages();
    const msg = messages[messages.length - 1]; // latest message in thread

    try {
      const id = generateId(msg.getId());
      if (seenIds.has(id)) continue;

      const raw = extractForwardedContent(msg);
      if (!raw) continue;

      const analysis = analyzeWithOpenAI(raw, apiKey);
      if (!analysis) continue;

      writeEventRow(sheet, id, raw, analysis);
      seenIds.add(id);
      added++;

      Utilities.sleep(1200); // stay within OpenAI rate limits
    } catch (err) {
      Logger.log(`Skipped message ${msg.getId()}: ${err.message}`);
    }
  }

  Logger.log(`Added ${added} new event(s).`);
  refreshShownTodayFlags(sheet);
}

/** Web app GET — returns today's events as JSON to the front-end. */
function doGet() {
  try {
    return jsonResponse(getTodayEvents());
  } catch (err) {
    Logger.log('doGet error: ' + err.message);
    return jsonResponse({ error: err.message });
  }
}

/** Web app POST — saves user star ratings and feedback back to the sheet. */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    saveRatings(payload);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ─── Gmail reading ────────────────────────────────────────────────────────────

function searchForwardedThreads() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GMAIL_SEARCH_DAYS);
  const dateStr = Utilities.formatDate(cutoff, 'UTC', 'yyyy/MM/dd');

  // Only scan forwarded emails from specific trusted senders
  const SENDERS = [
    'helenlee.lyk@gmail.com',
  ];

  const fromClause = SENDERS.map(s => `from:${s}`).join(' OR ');
  const query = `(${fromClause}) (subject:Fwd OR subject:FW OR subject:Fw) after:${dateStr}`;
  return GmailApp.search(query, 0, 50);
}

/**
 * Extracts the forwarded message body from a Gmail message.
 * Returns a structured object ready for Claude, or null if no content found.
 */
function extractForwardedContent(msg) {
  const rawBody  = msg.getPlainBody() || '';
  const subject  = msg.getSubject()   || '';

  // Common inline-forward delimiters — try each in order
  const fwdMarkers = [
    /[-─]{3,}\s*Forwarded [Mm]essage\s*[-─]{3,}/,
    /[-─]{3,}\s*Original [Mm]essage\s*[-─]{3,}/,
    /Begin forwarded message:/i,
    />{1,2}\s*[-─]{3,}/,
  ];

  let forwardedBlock = rawBody;
  for (const marker of fwdMarkers) {
    const pos = rawBody.search(marker);
    if (pos !== -1) {
      forwardedBlock = rawBody.substring(pos);
      break;
    }
  }

  // Strip the outer wrapper message if it's trivially short (just "FYI" etc.)
  const cleanSubject = subject.replace(/^(Fwd?:|FW:|Fw:)\s*/i, '').trim();

  return {
    subject:    cleanSubject,
    body:       forwardedBlock.substring(0, 4000), // cap tokens
    from:       msg.getFrom(),
    receivedAt: msg.getDate(),
  };
}

// ─── OpenAI analysis ─────────────────────────────────────────────────────────

function analyzeWithOpenAI(raw, apiKey) {
  const requestBody = {
    model: OPENAI_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content: 'You extract structured event information from forwarded emails and score their relevance as professional events worth attending.',
      },
      {
        role: 'user',
        content: buildPrompt(raw),
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'extract_event',
          description: 'Extract and score a professional event from a forwarded email.',
          parameters: {
            type: 'object',
            required: [
              'title', 'org', 'event_date', 'source', 'snippet',
              'link', 'ai_score', 'ai_reason', 'ai_tags', 'ai_suggested_action',
            ],
            properties: {
              title:               { type: 'string',  description: 'Event title' },
              org:                 { type: 'string',  description: 'Organising body or company' },
              event_date:          { type: 'string',  description: 'Date in YYYY-MM-DD, empty if unknown' },
              source:              { type: 'string',  description: 'Where this came from, e.g. newsletter name or "Email forward"' },
              snippet:             { type: 'string',  description: '1–2 sentence plain-English description of the event' },
              link:                { type: 'string',  description: 'Primary registration or info URL, empty string if none found' },
              ai_score:            { type: 'integer', description: 'Relevance score 1–5 (5 = must-attend professional event)', minimum: 1, maximum: 5 },
              ai_reason:           { type: 'string',  description: 'One sentence justifying the score' },
              ai_tags:             { type: 'array',   items: { type: 'string' }, description: 'Up to 5 short topic tags' },
              ai_suggested_action: { type: 'string',  description: 'Short next step, e.g. "Register before May 1" or "Save for later"' },
            },
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'extract_event' } },
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method:      'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
    },
    payload:          JSON.stringify(requestBody),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code !== 200) {
    Logger.log(`OpenAI API error ${code}: ${text}`);
    return null;
  }

  try {
    const json      = JSON.parse(text);
    const toolCall  = json.choices[0].message.tool_calls[0];
    return JSON.parse(toolCall.function.arguments);
  } catch (err) {
    Logger.log(`Could not parse OpenAI response: ${err.message}`);
    return null;
  }
}

function buildPrompt(raw) {
  return `A user forwarded the email below. Extract the event details and score its professional relevance.

Subject: ${raw.subject}
From: ${raw.from}
Received: ${raw.receivedAt}

--- Email body ---
${raw.body}
-----------------

Use the extract_event tool. If no clear event is present, still return a result with ai_score 1.`;
}

// ─── Google Sheet helpers ─────────────────────────────────────────────────────

function getOrCreateSheet() {
  const ss    = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = [
      'ID', 'Date Found', 'Event Date', 'Source', 'Org', 'Title',
      'Snippet', 'Link', 'AI Score', 'AI Reason', 'AI Tags',
      'AI Suggested Action', 'Shown Today?', 'User Star Rating',
      'User Feedback', 'Final Status',
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);

    // Basic formatting: bold header, auto-resize
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setColumnWidth(COL.SNIPPET, 300);
    sheet.setColumnWidth(COL.AI_REASON, 300);
    sheet.setColumnWidth(COL.LINK, 200);
  }

  return sheet;
}

function getExistingIds(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();
  const ids = sheet.getRange(2, COL.ID, lastRow - 1, 1).getValues().flat();
  return new Set(ids.filter(Boolean));
}

function writeEventRow(sheet, id, raw, analysis) {
  const tz  = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  sheet.appendRow([
    id,
    today,
    analysis.event_date            || '',
    analysis.source                || 'Email forward',
    analysis.org                   || '',
    analysis.title                 || raw.subject,
    analysis.snippet               || '',
    analysis.link                  || '',
    analysis.ai_score              || 1,
    analysis.ai_reason             || '',
    (analysis.ai_tags || []).join(', '),
    analysis.ai_suggested_action   || '',
    'FALSE',   // Shown Today?
    '',        // User Star Rating
    '',        // User Feedback
    'New',     // Final Status
  ]);
}

/**
 * Resets "Shown Today?" to FALSE for all rows, then marks the top
 * MAX_EVENTS_SHOWN highest-scoring un-reviewed events as TRUE.
 */
function refreshShownTodayFlags(sheet) {
  if (!sheet) sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const numRows = lastRow - 1;

  // Clear all flags
  sheet.getRange(2, COL.SHOWN_TODAY, numRows, 1)
       .setValues(Array(numRows).fill(['FALSE']));

  // Read scores and statuses to pick today's batch
  const data = sheet.getRange(2, 1, numRows, COL.FINAL_STATUS).getValues();

  const candidates = data
    .map((row, i) => ({
      rowIdx: i,
      score:  Number(row[COL.AI_SCORE - 1])    || 0,
      status: String(row[COL.FINAL_STATUS - 1]).toLowerCase(),
    }))
    .filter(r => r.score > 0 && r.status !== 'archived')
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EVENTS_SHOWN);

  candidates.forEach(({ rowIdx }) => {
    sheet.getRange(rowIdx + 2, COL.SHOWN_TODAY).setValue('TRUE');
  });
}

// ─── Web app data layer ───────────────────────────────────────────────────────

function getTodayEvents() {
  const sheet   = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, COL.FINAL_STATUS).getValues();

  return data
    .filter(row => String(row[COL.SHOWN_TODAY - 1]).toUpperCase() === 'TRUE')
    .map(row => ({
      id:                  row[COL.ID - 1],
      date:                row[COL.EVENT_DATE - 1],
      org:                 row[COL.ORG - 1],
      title:               row[COL.TITLE - 1],
      snippet:             row[COL.SNIPPET - 1],
      link:                row[COL.LINK - 1],
      ai_score:            Number(row[COL.AI_SCORE - 1]) || 0,
      ai_reason:           row[COL.AI_REASON - 1],
      tags:                String(row[COL.AI_TAGS - 1]).split(',').map(t => t.trim()).filter(Boolean),
      ai_suggested_action: row[COL.AI_SUGGESTED_ACTION - 1],
      user_rating:         row[COL.USER_STAR_RATING - 1] || null,
      user_feedback:       row[COL.USER_FEEDBACK - 1]    || '',
      status:              row[COL.FINAL_STATUS - 1],
    }));
}

function saveRatings(payload) {
  const sheet   = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const ids = sheet.getRange(2, COL.ID, lastRow - 1, 1).getValues().flat();

  payload.forEach(({ event_id, user_rating, user_feedback }) => {
    const rowIdx = ids.indexOf(event_id);
    if (rowIdx === -1) return;
    const sheetRow = rowIdx + 2;
    sheet.getRange(sheetRow, COL.USER_STAR_RATING).setValue(user_rating);
    sheet.getRange(sheetRow, COL.USER_FEEDBACK).setValue(user_feedback || '');
    sheet.getRange(sheetRow, COL.FINAL_STATUS)
         .setValue(Number(user_rating) >= 4 ? 'Starred' : 'Reviewed');
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function generateId(gmailMsgId) {
  // Short stable ID derived from Gmail message ID
  return 'evt-' + gmailMsgId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 14);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOpenAIApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY not set. Go to Project Settings > Script Properties and add it.');
  return key;
}

// ─── One-time setup (run manually from the editor) ────────────────────────────

/**
 * Run once to install a 7 AM daily trigger for fetchAndProcessEmails().
 */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'fetchAndProcessEmails')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('fetchAndProcessEmails')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();

  Logger.log('Daily trigger installed — fetchAndProcessEmails will run at 7 AM every day.');
}

/**
 * Manual test run — processes forwarded emails from the last GMAIL_SEARCH_DAYS days.
 * Run this first to verify everything is wired up correctly before installing the trigger.
 */
function testRun() {
  Logger.log('--- testRun starting ---');
  fetchAndProcessEmails();
  Logger.log('--- testRun complete ---');
}
