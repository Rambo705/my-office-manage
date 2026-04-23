/**
 * ============================================================
 *  Ziyan Service Manager — Frontend Update Guide for v6.0
 * ============================================================
 *
 *  Your ZiyanServiceManager.html needs these changes to work
 *  with the new SQLite server. Copy-paste into your HTML's
 *  <script> section, replacing the old SSE + save logic.
 * ============================================================
 */


// ─── 1. DATA LOADING — paginated, not all-at-once ─────────
// Replace any: fetch('/api/data') with loadJobs() + loadInvoices()

let currentPage    = 1;
let currentFilter  = null;   // e.g. 'pending', 'completed'
let currentSearch  = null;

async function loadJobs(page = 1, status = null, search = null) {
  const params = new URLSearchParams({ page, limit: 50 });
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const res  = await fetch(`/api/jobs?${params}`);
  const data = await res.json();

  renderJobs(data.jobs);          // your existing render function
  renderPagination(data);         // show page 1 of 40 etc.
  return data;
}

async function loadInvoices(page = 1, status = null, jobId = null) {
  const params = new URLSearchParams({ page, limit: 50 });
  if (status) params.set('status', status);
  if (jobId)  params.set('job_id', jobId);

  const res  = await fetch(`/api/invoices?${params}`);
  const data = await res.json();

  renderInvoices(data.invoices);
  return data;
}

// Simple pagination controls (add this somewhere in your UI)
function renderPagination({ page, pages, total, limit }) {
  document.getElementById('paginationInfo').textContent =
    `Page ${page} of ${pages} (${total} total)`;

  document.getElementById('btnPrev').disabled = (page <= 1);
  document.getElementById('btnNext').disabled = (page >= pages);

  document.getElementById('btnPrev').onclick = () => loadJobs(page - 1, currentFilter, currentSearch);
  document.getElementById('btnNext').onclick = () => loadJobs(page + 1, currentFilter, currentSearch);
}


// ─── 2. SAVING — one record at a time ──────────────────────
// Replace: fetch('/api/save', { body: JSON.stringify(entireDb) })
// With this:

async function saveJob(jobObj) {
  const res  = await fetch('/api/jobs', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(jobObj),
  });
  return res.json();   // { ok: true, job: {...} }
}

async function saveInvoice(invObj) {
  const res  = await fetch('/api/invoices', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(invObj),
  });
  return res.json();   // { ok: true, invoice: {...} }
}

async function deleteJob(jobId) {
  const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  return res.json();
}

async function deleteInvoice(invId) {
  const res = await fetch(`/api/invoices/${invId}`, { method: 'DELETE' });
  return res.json();
}


// ─── 3. IMAGES — upload separately, store filename ─────────
// Replace: embedding base64 inside job object
// With this:

async function uploadImage(base64DataUrl, refType, refId) {
  const res = await fetch('/api/upload', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dataUrl: base64DataUrl, refType, refId }),
  });
  const data = await res.json();
  // data.url = '/api/image/job_J123_0_1712345678.jpg'
  // Store data.filename in job.productImgs array
  return data;
}

// To display an image: just set src = `/api/image/${filename}`
// Example: <img src="/api/image/job_J123_0.jpg">


// ─── 4. SSE — react to single-record changes ───────────────
// Replace old SSE that expected full DB snapshot with this:

function connectSSE() {
  const es = new EventSource('/api/events');

  es.addEventListener('connected', (e) => {
    console.log('SSE connected:', JSON.parse(e.data));
    // Load first page on connect
    loadJobs(1);
    loadInvoices(1);
  });

  // A single job was saved/updated on another device
  es.addEventListener('job_saved', (e) => {
    const { job } = JSON.parse(e.data);
    updateOrInsertJobInUI(job);     // update just that one card
  });

  // A single job was deleted
  es.addEventListener('job_deleted', (e) => {
    const { id } = JSON.parse(e.data);
    removeJobFromUI(id);
  });

  // A single invoice was saved/updated
  es.addEventListener('invoice_saved', (e) => {
    const { invoice } = JSON.parse(e.data);
    updateOrInsertInvoiceInUI(invoice);
  });

  // Invoice deleted
  es.addEventListener('invoice_deleted', (e) => {
    const { id } = JSON.parse(e.data);
    removeInvoiceFromUI(id);
  });

  // Settings changed
  es.addEventListener('settings_saved', (e) => {
    const { settings } = JSON.parse(e.data);
    applySettings(settings);
  });

  // Bulk save from old-format clients — just reload current page
  es.addEventListener('bulk_saved', () => {
    loadJobs(currentPage, currentFilter, currentSearch);
    loadInvoices(1);
  });

  es.onerror = () => {
    console.warn('SSE disconnected, reconnecting in 5s...');
    setTimeout(connectSSE, 5000);
  };

  return es;
}

// Helper: update one job card without reloading the page
function updateOrInsertJobInUI(job) {
  const card = document.querySelector(`[data-job-id="${job.id}"]`);
  if (card) {
    // Update existing card in place
    card.querySelector('.customer-name').textContent = job.customer;
    card.querySelector('.status-badge').textContent  = job.status;
    // ... update other fields
  } else {
    // New job — prepend a card (if user is on page 1)
    if (currentPage === 1) {
      prependJobCard(job);
    }
  }
}

function removeJobFromUI(id) {
  document.querySelector(`[data-job-id="${id}"]`)?.remove();
}

function updateOrInsertInvoiceInUI(invoice) {
  const el = document.querySelector(`[data-invoice-id="${invoice.id}"]`);
  if (el) {
    el.querySelector('.amount').textContent = invoice.amount;
    el.querySelector('.inv-status').textContent = invoice.status;
  } else if (currentPage === 1) {
    prependInvoiceCard(invoice);
  }
}

function removeInvoiceFromUI(id) {
  document.querySelector(`[data-invoice-id="${id}"]`)?.remove();
}


// ─── 5. STARTUP ────────────────────────────────────────────
// Replace your DOMContentLoaded with:

document.addEventListener('DOMContentLoaded', () => {
  connectSSE();
  // SSE 'connected' event will trigger loadJobs + loadInvoices
});


// ─── HTML SNIPPETS to add to your UI ──────────────────────
/*
Add this pagination bar anywhere in your HTML:

<div id="pagination" style="display:flex; gap:10px; align-items:center; padding:10px">
  <button id="btnPrev">← Prev</button>
  <span id="paginationInfo">Page 1 of 1</span>
  <button id="btnNext">Next →</button>
</div>

Add data attributes to your job/invoice cards:
  <div class="job-card" data-job-id="{{job.id}}">...</div>
  <div class="invoice-card" data-invoice-id="{{inv.id}}">...</div>
*/
