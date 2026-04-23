const fs = require('fs');
const path = require('path');

const CLAY_WEBHOOK_URL = 'https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook-9e849e00-6838-4da3-b4eb-f862e035960b';
const USER_ID = '3f166004-174b-4fc6-88f0-7cd47332f6ee';
const DELAY_MS = 200; // small delay between rows to avoid rate limiting

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  return lines.slice(1).map(line => {
    // Handle quoted fields
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        inQuotes = !inQuotes;
      } else if (line[i] === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += line[i];
      }
    }
    values.push(current.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });
}

async function sendRow(row, index) {
  const payload = {
    user_id: USER_ID,
    full_name: row['Full Name'] || '',
    first_name: row['First Name'] || '',
    last_name: row['Last Name'] || '',
    company_name: row['Company name'] || '',
    job_title: row['Job Title'] || '',
    location: row['Location'] || '',
    company_domain: row['Company Domain'] || '',
    linkedin_url: row['LinkedIn Profile'] || '',
  };

  try {
    const res = await fetch(CLAY_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`[${index + 1}] ${payload.full_name} @ ${payload.company_name} → ${res.status}`);
    return res.status;
  } catch (err) {
    console.error(`[${index + 1}] ${payload.full_name} → ERROR: ${err.message}`);
    return null;
  }
}

async function main() {
  const csvPath = path.join(__dirname, 'template-contacts.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(content);

  console.log(`Sending ${rows.length} rows to Clay...`);

  let success = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const status = await sendRow(rows[i], i);
    if (status === 200 || status === 201 || status === 202) success++;
    else failed++;
    if (i < rows.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${success} sent, ${failed} failed.`);
}

main();
