# Daily Event Radar — Setup Guide

## Overview

| Layer | Tool | Purpose |
|---|---|---|
| Email source | Gmail (helenlee.lyk@gmail.com) | Reads forwarded event emails |
| Backend | Google Apps Script (`Code.gs`) | Processes emails, calls OpenAI, writes to Sheet |
| Storage | Google Sheets | Stores all event data and user ratings |
| AI | OpenAI API (`gpt-4o`) | Extracts and scores each event |
| Frontend | GitHub Pages / static host | Daily UI for rating events |

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet
2. Name it **Daily Event Radar**
3. Leave it open — you'll link it to the script in the next step

> The script creates all column headers automatically on first run. You do not need to add them manually.

---

## Step 2 — Set up Google Apps Script

1. Inside your Google Sheet, go to **Extensions → Apps Script**
2. You'll see a default `Code.gs` file — **delete all its contents**
3. Copy the entire contents of [`Code.gs`](./Code.gs) from this repo and paste it in
4. Click **Save** (or Ctrl+S) and name the project `Daily Event Radar`

---

## Step 3 — Add your OpenAI API key

1. In the Apps Script editor, click the **gear icon ⚙️ → Project Settings**
2. Scroll down to **Script Properties** and click **Add property**
3. Add:
   - Key: `OPENAI_API_KEY`
   - Value: your OpenAI secret key (starts with `sk-...`)
4. Click **Save**

> Get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## Step 4 — Test the pipeline

1. In the Apps Script editor, select the function `testRun` from the dropdown
2. Click **▶ Run**
3. Approve Gmail and Sheets permissions when prompted (first run only)
4. Open **View → Logs** to see what was processed

This scans your Gmail for forwarded emails from the last 24 hours, runs them through OpenAI, and writes results to the Sheet.

---

## Step 5 — Install the daily trigger

1. In the Apps Script editor, select the function `installDailyTrigger` from the dropdown
2. Click **▶ Run**
3. Check **View → Logs** — you should see: `Daily trigger installed — runs at 7 AM every day`

From this point on, `fetchAndProcessEmails` runs automatically every morning at 7 AM.

---

## Step 6 — Deploy as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**
2. Click the **gear icon** next to "Select type" and choose **Web app**
3. Set:
   - Description: `Daily Event Radar`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Copy the **Web app URL** — you'll need it for the frontend

---

## Step 7 — Connect the frontend

1. Open [`script.js`](./script.js) in this repo
2. Replace the placeholder URL at the top:

```js
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_DEPLOYMENT_URL_HERE';
```

3. Paste in the URL you copied in Step 6
4. Push to GitHub — your frontend is now live and connected

---

## Gmail setup (recommended)

The script searches for emails with `Fwd:`, `FW:`, or `Fw:` in the subject line from the last 24 hours.

To make sure the right emails are picked up, forward event emails to yourself from helenlee.lyk@gmail.com with the subject intact (e.g. `Fwd: TechConf 2026 — Register Now`).

**Optional — create a label filter:**
1. In Gmail, create a label called `events`
2. Set up a filter to auto-label forwarded event emails
3. Update the search query in `Code.gs` if you want to filter by label:

```js
const query = `label:events after:${dateStr}`;
```

---

## Column reference

| Column | Filled by | Description |
|---|---|---|
| ID | Script | Stable ID derived from Gmail message ID |
| Date Found | Script | Date the email was processed |
| Event Date | OpenAI | Date the event occurs (YYYY-MM-DD) |
| Source | OpenAI | Newsletter name or "Email forward" |
| Org | OpenAI | Organising body or company |
| Title | OpenAI | Event title |
| Snippet | OpenAI | 1–2 sentence description |
| Link | OpenAI | Registration or info URL |
| AI Score | OpenAI | Relevance score 1–5 |
| AI Reason | OpenAI | One sentence justifying the score |
| AI Tags | OpenAI | Up to 5 topic tags (comma-separated) |
| AI Suggested Action | OpenAI | e.g. "Register before May 1" |
| Shown Today? | Script | TRUE for the top 5 events of the day |
| User Star Rating | Frontend | Your 1–5 star rating |
| User Feedback | Frontend | Your optional comment |
| Final Status | Frontend | New / Reviewed / Starred |

---

## Function reference

| Function | How to run | What it does |
|---|---|---|
| `testRun()` | Manually in editor | Processes the last 24 h of forwarded emails |
| `installDailyTrigger()` | Manually once | Schedules 7 AM daily automation |
| `fetchAndProcessEmails()` | Auto (trigger) | Full pipeline: Gmail → OpenAI → Sheet |
| `doGet()` | Auto (web app) | Serves today's events to the frontend |
| `doPost()` | Auto (web app) | Saves user ratings back to the Sheet |

---

## Troubleshooting

**No emails processed**
- Check that forwarded emails exist in the last 24 hours with `Fwd:` / `FW:` in the subject
- Open **View → Logs** and look for `Found 0 forwarded thread(s)`
- Try increasing `GMAIL_SEARCH_DAYS` at the top of `Code.gs`

**OpenAI API error**
- Confirm `OPENAI_API_KEY` is set correctly in Script Properties
- Check the key is active at [platform.openai.com](https://platform.openai.com)
- View the full error in **View → Logs**

**Sheet not updating**
- Make sure the script is bound to the correct spreadsheet (opened via Extensions → Apps Script from inside the Sheet)
- Run `testRun()` and check the logs for any errors

**Frontend shows no events / sample data**
- Verify the `APPS_SCRIPT_URL` in `script.js` matches your deployed web app URL
- Make sure the web app is deployed with "Execute as: Me" and "Who has access: Anyone"
- Redeploy after any code changes (Deploy → Manage deployments → edit)

**Permissions error on first run**
- Click **Review permissions → Allow** when prompted
- The script needs Gmail (read) and Sheets (read/write) access

---

## Deployment checklist

- [ ] Google Sheet created
- [ ] `Code.gs` pasted into Apps Script editor
- [ ] `OPENAI_API_KEY` added to Script Properties
- [ ] `testRun()` executed successfully — rows appear in Sheet
- [ ] `installDailyTrigger()` executed — 7 AM trigger confirmed
- [ ] Web app deployed — URL copied
- [ ] `APPS_SCRIPT_URL` updated in `script.js`
- [ ] Frontend loads and displays events
- [ ] Star ratings save back to Sheet
