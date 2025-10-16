const $ = sel => document.querySelector(sel);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let syllables = [];

function splitInput(raw) {
  return (raw || "")
    .split(/[\n,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function upsertSyllable(syl, limit = null) {
  if (!syl) return;
  const idx = syllables.findIndex(x => x.syl === syl);
  if (idx >= 0) {
    if (limit !== null && !Number.isNaN(limit)) syllables[idx].limit = limit;
  } else {
    syllables.push({ syl, limit: limit });
  }
}
// --- Console-Dump -> "SYL:NUM, SYL, ..." ---
// Regel: Eine Zahlzeile (VM…:10 <NUM>) gehört IMMER zur direkt vorherigen Silbe (VM…:12 <SYL>).
function normalizeConsoleDumpToAddLine(raw) {
  const text = String(raw || '').toUpperCase();

  const re = /VM\d+:(\d+)\s+([A-ZÄÖÜß0-9]{1,4})/gi;
  const sylOnly = /^[A-ZÄÖÜß]{1,4}$/;
  const numOnly = /^\d+$/;

  const order = [];                   // Reihenfolge des ersten Auftretens
  const seen  = new Set();            // Duplikate vermeiden
  const counts = Object.create(null); // SILBE -> zuletzt gesehene Zahl (>1), sonst 1

  let lastSyl = null;                 // die zuletzt gesehene Silbe (wartet evtl. auf ihre Zahl)

  for (const m of text.matchAll(re)) {
    const code = Number(m[1]);
    const tok  = m[2];

    if (code === 12 && sylOnly.test(tok)) {
      // neue Silbe beginnt; die vorherige hat ggf. keine Zahl (=> 1)
      lastSyl = tok;
      if (!seen.has(tok)) { seen.add(tok); order.push(tok); }
      if (!(tok in counts)) counts[tok] = 1; // Default 1, falls keine Zahl folgt
      continue;
    }

    if (code === 10 && numOnly.test(tok)) {
      // Zahl gehört zur *vorherigen* Silbe, falls vorhanden
      if (lastSyl) {
        const n = Number(tok) || 1;
        counts[lastSyl] = n > 0 ? n : 1;  // „letzter gesehener Wert“ pro Silbe
        lastSyl = null;                   // danach ist die nächste Zeile eine neue Silbe
      }
      continue;
    }

    // Mischformen wie 1M ignorieren
  }

  // Ausgabe in Erstauftretens-Reihenfolge; :1 auslassen
  const items = order.map(s => counts[s] > 1 ? `${s}:${counts[s]}` : s);
  return items.join(', ');
}

function addFromConsoleDump(raw) {
  const line = normalizeConsoleDumpToAddLine(raw);
  if (!line) return 0;
  addFromRaw(line);                              // dein bestehender Parser frisst "SYL:NUM"
  return line.split(/\s*,\s*/).length;
}

function addFromRaw(raw) {
  const parts = splitInput(raw);
  const def = parseInt($('#globalLimit').value || '1', 10);
  for (const p of parts) {
    const m = p.match(/^(.*?):(\d+)$/);
    if (m) {
      const syl = m[1].trim();
      const lim = Math.max(0, parseInt(m[2], 10));
      if (syl) upsertSyllable(syl, lim);
    } else {
      upsertSyllable(p, def);
    }
  }
  syllables.sort((a, b) => b.syl.length - a.syl.length || a.syl.localeCompare(b.syl));
  renderChips();
}

function renderChips() {
  const box = $('#syllableChips');
  if (!syllables.length) { box.textContent = '– none –'; return; }
  box.innerHTML = syllables.map((it, i) => `
    <span class="chip" data-idx="${i}">
      <strong>${it.syl}</strong>
      <span class="small">max</span>
      <input type="number" min="0" value="${typeof it.limit === 'number' ? it.limit : (parseInt($('#globalLimit').value)||1)}" data-role="limit" title="Max repeats" />
      <button title="Remove" data-role="remove">×</button>
    </span>
  `).join(' ');
  box.querySelectorAll('input[data-role="limit"]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const chip = e.target.closest('.chip');
      const idx = parseInt(chip.getAttribute('data-idx'));
      const val = Math.max(0, parseInt(e.target.value || '0', 10));
      syllables[idx].limit = val;
    });
  });
  box.querySelectorAll('button[data-role="remove"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      const idx = parseInt(chip.getAttribute('data-idx'));
      syllables.splice(idx, 1);
      renderChips();
    });
  });
}

function buildRegex(list, useAnchors) {
  if (!list.length) return '';
  const norm = list.map(x => ({
    syl: x.syl,
    limit: (typeof x.limit === 'number' && x.limit >= 0)
      ? x.limit
      : Math.max(0, parseInt($('#globalLimit').value || '1', 10))
  }));
  const lookaheads = norm.map(({syl, limit}) => `(?!(?:.*${escapeRegex(syl)}){${limit + 1}})`);
  const alt = norm.map(({syl}) => escapeRegex(syl)).join('|');
  const body = `(?:${alt})*`;
  return `${useAnchors ? '^' : ''}${lookaheads.join('')}${body}${useAnchors ? '$' : ''}`;
}

function testRegex(pattern, ignoreCase) {
  const status = $('#testStatus');
  const sample = $('#testInput').value || '';
  if (!pattern) { status.textContent = 'No test yet.'; status.className = 'status'; return; }
  try {
    const flags = ignoreCase ? 'i' : '';
    const re = new RegExp(pattern, flags);
    const ok = re.test(sample);
    status.textContent = ok ? 'MATCH ✅' : 'NO MATCH ⛔️';
    status.className = 'status ' + (ok ? 'good' : 'bad');
  } catch (e) {
    status.textContent = 'Regex error: ' + e.message;
    status.className = 'status bad';
  }
}

function generate() {
  const pattern = buildRegex(syllables, $('#useAnchors').checked);
  $('#output').value = pattern;
  testRegex(pattern, $('#ignoreCase').checked);
}

$('#btnAdd').addEventListener('click', () => {
  const raw = $('#addInput').value;
  if (!raw.trim()) return;

  // 1) Versuch: kompletten Console-Dump parsen & als "SYL[:NUM], ..." einspeisen
  const added = addFromConsoleDump(raw);

  // 2) Falls nix erkannt -> normales freies Format
  if (!added) addFromRaw(raw);

  $('#addInput').value = '';
});

// Komfort: direkt nach Paste automatisch parsen
$('#addInput').addEventListener('paste', () => {
  setTimeout(() => {
    const raw = $('#addInput').value;
    const added = addFromConsoleDump(raw);
    if (added) $('#addInput').value = '';
  }, 0);
});


$('#addInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#btnAdd').click(); }
});

$('#btnGen').addEventListener('click', generate);

$('#btnCopy').addEventListener('click', async () => {
  const txt = $('#output').value;
  if (!txt) return;
  try { await navigator.clipboard.writeText(txt); } catch {}
  const btn = $('#btnCopy');
  const old = btn.textContent; btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = old, 900);
});

$('#btnReset').addEventListener('click', () => {
  syllables = [];
  renderChips();
  $('#addInput').value = '';
  $('#output').value = '';
  $('#testInput').value = '';
  $('#testStatus').textContent = 'No test yet.';
  $('#testStatus').className = 'status';
  $('#globalLimit').value = 1;
  $('#useAnchors').checked = true;
  $('#ignoreCase').checked = true;
});

$('#testInput').addEventListener('input', () => testRegex($('#output').value, $('#ignoreCase').checked));
$('#ignoreCase').addEventListener('change', () => testRegex($('#output').value, $('#ignoreCase').checked));
