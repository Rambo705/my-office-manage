/**
 * Ziyan Service Manager — LAN Server  v6.1
 * ==========================================
 * Run: node server.js
 * Install once: npm install sql.js
 *
 * ✅ sql.js:     Pure JavaScript SQLite — zero compilation, any Node version
 * ✅ PAGINATED:  API returns 50 rows at a time — never sends all 200k
 * ✅ SMART SSE:  Broadcasts only the changed record — not the whole DB
 * ✅ IMAGES:     Stored as files on disk — never bloat the DB
 * ✅ MIGRATION:  Auto-imports your existing db.json on first run
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const zlib = require('zlib');

const PORT      = process.env.PORT || 3000;
const DB_PATH   = path.join(__dirname, 'ziyan.db');
const HTML_FILE = path.join(__dirname, 'ZiyanServiceManager.html');
const IMG_DIR   = path.join(__dirname, 'uploads');
const OLD_JSON  = path.join(__dirname, 'db.json');

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

const initSqlJs = require('sql.js');
let DB;

async function openDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    DB = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log(`[${ts()}] Loaded DB: ${DB_PATH}`);
  } else {
    DB = new SQL.Database();
    console.log(`[${ts()}] Created new DB`);
  }
  DB.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, customer TEXT DEFAULT '', phone TEXT DEFAULT '',
      status TEXT DEFAULT 'pending', device TEXT DEFAULT '', issue TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      data TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, job_id TEXT DEFAULT '', amount REAL DEFAULT 0,
      status TEXT DEFAULT 'unpaid', created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')), data TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX IF NOT EXISTS idx_jobs_status   ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer);
    CREATE INDEX IF NOT EXISTS idx_jobs_created  ON jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_inv_job       ON invoices(job_id);
    CREATE INDEX IF NOT EXISTS idx_inv_status    ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_inv_created   ON invoices(created_at);
  `);
  if (!dbGet("SELECT value FROM settings WHERE key='migrated'") && fs.existsSync(OLD_JSON)) migrateJson();
  persistDB();
}

function dbRun(sql, params = []) { DB.run(sql, params); }
function dbGet(sql, params = []) {
  const s = DB.prepare(sql); s.bind(params);
  const r = s.step() ? s.getAsObject() : null; s.free(); return r;
}
function dbAll(sql, params = []) {
  const s = DB.prepare(sql); s.bind(params);
  const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows;
}

let saveTimer = null;
function persistDB() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_PATH, Buffer.from(DB.export())); }
    catch (e) { console.error(`[${ts()}] DB save failed:`, e.message); }
  }, 300);
}

function migrateJson() {
  console.log(`[${ts()}] Migrating db.json to SQLite...`);
  try {
    const old = JSON.parse(fs.readFileSync(OLD_JSON, 'utf8'));
    const now = new Date().toISOString();
    let jCount = 0, iCount = 0;
    for (const j of (old.jobs || [])) {
      const { id, jobId, customer, phone, status, device, issue, createdAt, created_at, productImg, productImgs, ...rest } = j;
      const imgs = productImgs || (productImg ? [productImg] : []);
      const savedFiles = [];
      imgs.forEach((img, i) => {
        if (img && img.startsWith('data:')) { const f = `job_${id||jobId}_${i}.jpg`; saveBase64Image(img, f); savedFiles.push(f); }
      });
      rest._imgFiles = savedFiles;
      dbRun(`INSERT OR IGNORE INTO jobs (id,customer,phone,status,device,issue,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id||jobId||`J${Date.now()}_${jCount}`, customer||'', phone||'', status||'pending', device||'', issue||'', createdAt||created_at||now, now, JSON.stringify(rest)]);
      jCount++;
    }
    for (const inv of (old.invoices || [])) {
      const { id, invId, job_id, jobId, amount, status, createdAt, created_at, paymentImg, paymentImgFull, ...rest } = inv;
      const realId = id||invId||`I${Date.now()}_${iCount}`;
      const bestImg = paymentImgFull||paymentImg||'';
      if (bestImg && bestImg.startsWith('data:')) { const f = `inv_${realId}_payment.jpg`; saveBase64Image(bestImg, f); rest._payImgFile = f; }
      dbRun(`INSERT OR IGNORE INTO invoices (id,job_id,amount,status,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?)`,
        [realId, job_id||jobId||'', parseFloat(amount)||0, status||'unpaid', createdAt||created_at||now, now, JSON.stringify(rest)]);
      iCount++;
    }
    if (old.settings) for (const [k,v] of Object.entries(old.settings)) dbRun(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`, [k, typeof v==='string'?v:JSON.stringify(v)]);
    dbRun(`INSERT OR REPLACE INTO settings(key,value) VALUES('migrated','true')`);
    fs.renameSync(OLD_JSON, OLD_JSON+'.backup');
    console.log(`[${ts()}] Migration done: ${jCount} jobs, ${iCount} invoices. db.json -> db.json.backup`);
  } catch (e) { console.error(`[${ts()}] Migration failed:`, e.message); }
}

function saveBase64Image(dataUrl, filename) {
  try {
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(path.join(IMG_DIR, filename), Buffer.from(base64, 'base64'));
  } catch (e) { console.error(`[${ts()}] Image save failed (${filename}):`, e.message); }
}

function rowToJob(row) {
  if (!row) return null;
  const extra = JSON.parse(row.data||'{}');
  return { id:row.id, customer:row.customer, phone:row.phone, status:row.status, device:row.device, issue:row.issue, created_at:row.created_at, updated_at:row.updated_at, ...extra };
}
function rowToInvoice(row) {
  if (!row) return null;
  const extra = JSON.parse(row.data||'{}');
  return { id:row.id, job_id:row.job_id, amount:row.amount, status:row.status, created_at:row.created_at, updated_at:row.updated_at, ...extra };
}

let htmlCache = null, htmlGzip = null;
function reloadHTML() {
  try {
    const raw = fs.readFileSync(HTML_FILE, 'utf8');
    htmlCache = raw; htmlGzip = zlib.gzipSync(raw);
    console.log(`[${ts()}] HTML loaded (${(htmlGzip.length/1024).toFixed(1)} KB gzipped)`);
  } catch { htmlCache = '<h1>ZiyanServiceManager.html not found</h1>'; htmlGzip = zlib.gzipSync(htmlCache); }
}

const sseClients = new Set();
let sseId = 0;
function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  const dead = [];
  for (const c of sseClients) { try { c.res.write(msg); } catch { dead.push(c); } }
  dead.forEach(c => sseClients.delete(c));
}

function ts() { return new Date().toLocaleTimeString(); }

function sendJSON(res, obj, status = 200) {
  if (res._gz) {
    const buf = zlib.gzipSync(JSON.stringify(obj));
    res.writeHead(status, { 'Content-Type':'application/json', 'Content-Encoding':'gzip', 'Content-Length':buf.length, 'Cache-Control':'no-store' });
    res.end(buf);
  } else {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    res.writeHead(status, { 'Content-Type':'application/json', 'Content-Length':buf.length, 'Cache-Control':'no-store' });
    res.end(buf);
  }
}

function parseQS(url) { return Object.fromEntries(new URL(url, 'http://x').searchParams); }

function readBody(req, maxBytes = 100*1024*1024) {
  return new Promise((resolve, reject) => {
    let body = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > maxBytes) { req.destroy(); return reject(new Error('Too large')); } body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  req.setTimeout(60000, () => { if (!res.writableEnded) { res.writeHead(408); res.end(); } });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept-Encoding');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  res._gz = (req.headers['accept-encoding']||'').includes('gzip');

  const url = req.url.split('?')[0];
  const method = req.method;

  try {
    // HTML
    if ((url==='/'||url==='/index.html') && method==='GET') {
      if (res._gz) {
        res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Encoding':'gzip', 'Content-Length':htmlGzip.length, 'Cache-Control':'no-cache' });
        res.end(htmlGzip);
      } else {
        const buf = Buffer.from(htmlCache,'utf8');
        res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Length':buf.length });
        res.end(buf);
      }
      return;
    }

    // Status
    if (url==='/api/status' && method==='GET') {
      sendJSON(res, { ok:true, version:'6.1', engine:'sql.js', clients:sseClients.size,
        jobs:dbGet('SELECT COUNT(*) as n FROM jobs').n, invoices:dbGet('SELECT COUNT(*) as n FROM invoices').n,
        uptime:Math.floor(process.uptime())+'s' });
      return;
    }

    // SSE
    if (url==='/api/events' && method==='GET') {
      const clientId = ++sseId;
      res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache, no-transform', 'Connection':'keep-alive', 'X-Accel-Buffering':'no' });
      res.write(`event: connected\ndata: ${JSON.stringify({ clientId, version:'6.1' })}\n\n`);
      const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); } }, 25000);
      const client = { res, id:clientId };
      sseClients.add(client);
      console.log(`[${ts()}] #${clientId} connected (${sseClients.size} online)`);
      req.on('close', () => { clearInterval(hb); sseClients.delete(client); console.log(`[${ts()}] #${clientId} left (${sseClients.size} remaining)`); });
      return;
    }

    // --- JOBS ---
    if (url==='/api/jobs' && method==='GET') {
      const q = parseQS(req.url);
      const limit = Math.min(parseInt(q.limit||'50'),200), page = Math.max(parseInt(q.page||'1'),1), offset=(page-1)*limit;
      let where='WHERE 1=1'; const params=[];
      if (q.status) { where+=' AND status=?'; params.push(q.status); }
      if (q.search) { const s=`%${q.search}%`; where+=' AND (customer LIKE ? OR phone LIKE ? OR device LIKE ?)'; params.push(s,s,s); }
      const rows = dbAll(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params,limit,offset]);
      const total = dbGet(`SELECT COUNT(*) as n FROM jobs ${where}`, params).n;
      sendJSON(res, { jobs:rows.map(rowToJob), page, limit, total, pages:Math.ceil(total/limit) });
      return;
    }

    if (url.startsWith('/api/jobs/') && method==='GET') {
      const row = dbGet('SELECT * FROM jobs WHERE id=?', [url.split('/')[3]]);
      if (!row) { sendJSON(res, { error:'Not found' }, 404); return; }
      sendJSON(res, rowToJob(row)); return;
    }

    if (url==='/api/jobs' && method==='POST') {
      const body = JSON.parse(await readBody(req));
      const now = new Date().toISOString();
      const { id, customer, phone, status, device, issue, created_at, ...rest } = body;
      if (rest.productImgs) {
        const saved=[];
        rest.productImgs.forEach((img,i) => {
          if (img && img.startsWith('data:')) { const f=`job_${id}_${i}_${Date.now()}.jpg`; saveBase64Image(img,f); saved.push(f); }
          else if (img) saved.push(img);
        });
        rest.productImgs=saved; rest.productImg=saved[0]||null;
      }
      const rowId = id||`J${Date.now()}`;
      dbRun(`INSERT INTO jobs (id,customer,phone,status,device,issue,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET customer=excluded.customer,phone=excluded.phone,status=excluded.status,device=excluded.device,issue=excluded.issue,updated_at=excluded.updated_at,data=excluded.data`,
        [rowId,customer||'',phone||'',status||'pending',device||'',issue||'',created_at||now,now,JSON.stringify(rest)]);
      const saved = rowToJob(dbGet('SELECT * FROM jobs WHERE id=?',[rowId]));
      broadcast('job_saved', { job:saved }); persistDB();
      sendJSON(res, { ok:true, job:saved });
      console.log(`[${ts()}] Job saved: ${rowId}`); return;
    }

    if (url.startsWith('/api/jobs/') && method==='DELETE') {
      const id=url.split('/')[3]; dbRun('DELETE FROM jobs WHERE id=?',[id]);
      broadcast('job_deleted',{id}); persistDB(); sendJSON(res,{ok:true,id}); return;
    }

    // --- INVOICES ---
    if (url==='/api/invoices' && method==='GET') {
      const q = parseQS(req.url);
      const limit=Math.min(parseInt(q.limit||'50'),200), page=Math.max(parseInt(q.page||'1'),1), offset=(page-1)*limit;
      let where='WHERE 1=1'; const params=[];
      if (q.status) { where+=' AND status=?'; params.push(q.status); }
      if (q.job_id) { where+=' AND job_id=?'; params.push(q.job_id); }
      const rows = dbAll(`SELECT * FROM invoices ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params,limit,offset]);
      const total = dbGet(`SELECT COUNT(*) as n FROM invoices ${where}`, params).n;
      sendJSON(res, { invoices:rows.map(rowToInvoice), page, limit, total, pages:Math.ceil(total/limit) });
      return;
    }

    if (url.startsWith('/api/invoices/') && method==='GET') {
      const row = dbGet('SELECT * FROM invoices WHERE id=?',[url.split('/')[3]]);
      if (!row) { sendJSON(res,{error:'Not found'},404); return; }
      sendJSON(res, rowToInvoice(row)); return;
    }

    if (url==='/api/invoices' && method==='POST') {
      const body = JSON.parse(await readBody(req));
      const now = new Date().toISOString();
      const { id, invId, job_id, jobId, amount, status, created_at, ...rest } = body;
      const realId = id||invId||`I${Date.now()}`;
      const bestImg = rest.paymentImgFull||rest.paymentImg||'';
      if (bestImg && bestImg.startsWith('data:')) {
        const f=`inv_${realId}_payment_${Date.now()}.jpg`; saveBase64Image(bestImg,f);
        rest._payImgFile=f; delete rest.paymentImg; delete rest.paymentImgFull;
      }
      dbRun(`INSERT INTO invoices (id,job_id,amount,status,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET job_id=excluded.job_id,amount=excluded.amount,status=excluded.status,updated_at=excluded.updated_at,data=excluded.data`,
        [realId,job_id||jobId||'',parseFloat(amount)||0,status||'unpaid',created_at||now,now,JSON.stringify(rest)]);
      const saved = rowToInvoice(dbGet('SELECT * FROM invoices WHERE id=?',[realId]));
      broadcast('invoice_saved',{invoice:saved}); persistDB();
      sendJSON(res,{ok:true,invoice:saved});
      console.log(`[${ts()}] Invoice saved: ${realId}`); return;
    }

    if (url.startsWith('/api/invoices/') && method==='DELETE') {
      const id=url.split('/')[3]; dbRun('DELETE FROM invoices WHERE id=?',[id]);
      broadcast('invoice_deleted',{id}); persistDB(); sendJSON(res,{ok:true,id}); return;
    }

    // --- IMAGES ---
    if (url.startsWith('/api/image/') && method==='GET') {
      const fname=decodeURIComponent(url.split('/')[3]);
      const fpath=path.join(IMG_DIR, path.basename(fname));
      if (!fs.existsSync(fpath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext=path.extname(fname).toLowerCase();
      const mime={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'}[ext]||'application/octet-stream';
      const buf=fs.readFileSync(fpath);
      res.writeHead(200,{'Content-Type':mime,'Content-Length':buf.length,'Cache-Control':'public, max-age=86400'});
      res.end(buf); return;
    }

    if (url==='/api/upload' && method==='POST') {
      const body = JSON.parse(await readBody(req, 50*1024*1024));
      const { dataUrl, refType, refId } = body;
      if (!dataUrl||!dataUrl.startsWith('data:')) { sendJSON(res,{error:'Invalid image'},400); return; }
      const fname=`${refType||'img'}_${refId||'x'}_${Date.now()}.jpg`;
      saveBase64Image(dataUrl, fname);
      sendJSON(res,{ok:true,filename:fname,url:`/api/image/${fname}`}); return;
    }

    // --- SETTINGS ---
    if (url==='/api/settings' && method==='GET') {
      const rows=dbAll("SELECT key,value FROM settings WHERE key != 'migrated'");
      const out={}; rows.forEach(r=>{ try{out[r.key]=JSON.parse(r.value);}catch{out[r.key]=r.value;} });
      sendJSON(res, out); return;
    }

    if (url==='/api/settings' && method==='POST') {
      const body = JSON.parse(await readBody(req));
      for (const [k,v] of Object.entries(body)) dbRun(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`,[k,typeof v==='string'?v:JSON.stringify(v)]);
      persistDB(); broadcast('settings_saved',{settings:body}); sendJSON(res,{ok:true}); return;
    }

    // --- LEGACY /api/save (old HTML still works) ---
    if (url==='/api/save' && method==='POST') {
      const body = JSON.parse(await readBody(req));
      const now = new Date().toISOString();
      let jCount=0, iCount=0;
      for (const j of (body.jobs||[])) {
        const { id, jobId, customer, phone, status, device, issue, created_at, ...rest } = j;
        dbRun(`INSERT INTO jobs (id,customer,phone,status,device,issue,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET customer=excluded.customer,phone=excluded.phone,status=excluded.status,device=excluded.device,issue=excluded.issue,updated_at=excluded.updated_at,data=excluded.data`,
          [id||jobId||`J${Date.now()}_${jCount}`,customer||'',phone||'',status||'pending',device||'',issue||'',created_at||now,now,JSON.stringify(rest)]);
        jCount++;
      }
      for (const inv of (body.invoices||[])) {
        const { id, invId, job_id, jobId, amount, status, created_at, ...rest } = inv;
        const rid=id||invId||`I${Date.now()}_${iCount}`;
        dbRun(`INSERT INTO invoices (id,job_id,amount,status,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET job_id=excluded.job_id,amount=excluded.amount,status=excluded.status,updated_at=excluded.updated_at,data=excluded.data`,
          [rid,job_id||jobId||'',parseFloat(amount)||0,status||'unpaid',created_at||now,now,JSON.stringify(rest)]);
        iCount++;
      }
      if (body.settings) for (const [k,v] of Object.entries(body.settings)) dbRun(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`,[k,typeof v==='string'?v:JSON.stringify(v)]);
      persistDB(); broadcast('bulk_saved',{jobs:jCount,invoices:iCount});
      sendJSON(res,{ok:true,saved:now,clients:sseClients.size});
      console.log(`[${ts()}] Bulk save: ${jCount} jobs, ${iCount} invoices`); return;
    }

    // Legacy /api/data — first page for old frontends
    if (url==='/api/data' && method==='GET') {
      const jobs=dbAll('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50').map(rowToJob);
      const invoices=dbAll('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 50').map(rowToInvoice);
      const settings={}; dbAll("SELECT key,value FROM settings WHERE key!='migrated'").forEach(r=>{try{settings[r.key]=JSON.parse(r.value);}catch{settings[r.key]=r.value;}});
      sendJSON(res,{jobs,invoices,settings}); return;
    }

    res.writeHead(404,{'Content-Type':'text/plain'}); res.end('Not Found');

  } catch (e) {
    console.error(`[${ts()}] Error:`, e.message);
    if (!res.writableEnded) sendJSON(res,{error:e.message},500);
  }
});

server.keepAliveTimeout = 10000;
server.headersTimeout   = 11000;

async function boot() {
  reloadHTML();
  try { fs.watch(HTML_FILE,{persistent:false},ev=>{if(ev==='change')setTimeout(reloadHTML,50);}); } catch {}
  await openDatabase();
  server.listen(PORT,'0.0.0.0',() => {
    const ips=[];
    Object.values(os.networkInterfaces()).forEach(list=>(list||[]).forEach(i=>{if(i.family==='IPv4'&&!i.internal)ips.push(i.address);}));
    const jobCount=dbGet('SELECT COUNT(*) as n FROM jobs').n;
    const invCount=dbGet('SELECT COUNT(*) as n FROM invoices').n;
    console.log('\n');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   🔧  Ziyan Service Manager — LAN Server     ║');
    console.log('║       v6.1  sql.js · Paginated · Smart SSE  ║');
    console.log('╠══════════════════════════════════════════════╣');
    if (ips.length) { console.log('║  📱 Open on your phone:                      ║'); ips.forEach(ip=>console.log(`║     http://${ip}:${PORT}`.padEnd(47)+'║')); }
    console.log(`║  🖥️  Local:  http://localhost:${PORT}`.padEnd(47)+'║');
    console.log('║  🗄️  Engine: sql.js (pure JS — no compile)   ║');
    console.log('║  📡 SSE: per-record delta push               ║');
    console.log('║  🖼️  Images: /uploads/ folder                ║');
    console.log(`║  📂 ${jobCount} jobs, ${invCount} invoices`.padEnd(46)+'║');
    console.log('║  Press Ctrl+C to stop                        ║');
    console.log('╚══════════════════════════════════════════════╝\n');
  });
  server.on('error',err=>{
    if(err.code==='EADDRINUSE') console.error(`\nPort ${PORT} in use. Try: PORT=3001 node server.js\n`);
    else console.error('Server error:',err);
    process.exit(1);
  });
}

function shutdown() {
  console.log(`\n[${ts()}] Shutting down — saving DB...`);
  if (saveTimer) clearTimeout(saveTimer);
  try { fs.writeFileSync(DB_PATH, Buffer.from(DB.export())); console.log(`[${ts()}] DB saved.`); }
  catch (e) { console.error('Final save failed:',e.message); }
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(0),2000);
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);

boot().catch(e=>{console.error('Boot failed:',e);process.exit(1);});
