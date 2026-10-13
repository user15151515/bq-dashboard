// ==UserScript==
// @name         Claret Stats · Sync
// @namespace    claret-stats
// @version      1.0.0
// @description  Envía las estadísticas del equipo y de cada partido de basquetcatala.cat a tu repo de GitHub.
// @match        https://www.basquetcatala.cat/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @connect      msstats.optimalwayconsulting.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const API = 'https://msstats.optimalwayconsulting.com/v1/fcbq';
  const DEFAULT_TEAM = '3421ba54-3b7a-4961-b802-4a51648c1471'; // U.E. CLARET A

  // ---------- config ----------
  const cfg = () => ({
    repo: GM_getValue('repo', ''),          // usuario/repositorio
    branch: GM_getValue('branch', 'main'),
    token: GM_getValue('token', ''),
    team: GM_getValue('team', DEFAULT_TEAM),
  });

  function configure() {
    const c = cfg();
    const repo = prompt('Repositorio de GitHub (usuario/repo)', c.repo || '');
    if (repo === null) return false;
    const branch = prompt('Rama', c.branch || 'main');
    if (branch === null) return false;
    const token = prompt('Token de GitHub (fine-grained, Contents: Read and write). Déjalo vacío para mantener el actual.', '');
    if (token === null) return false;
    GM_setValue('repo', repo.trim());
    GM_setValue('branch', (branch || 'main').trim());
    if (token.trim()) GM_setValue('token', token.trim());
    toast('Configuración guardada', 'ok');
    return true;
  }
  GM_registerMenuCommand('⚙️ Configurar GitHub', configure);
  GM_registerMenuCommand('🔄 Sincronizar ahora', () => sync());
  GM_registerMenuCommand('♻️ Sincronizar todo (forzar partidos)', () => sync({ force: true }));

  // ---------- http ----------
  function gm(method, url, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, headers,
        data: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        responseType: 'text',
        onload: r => {
          let json = null;
          try { json = r.responseText ? JSON.parse(r.responseText) : null; } catch (_) { /* no json */ }
          resolve({ status: r.status, json, text: r.responseText });
        },
        onerror: () => reject(new Error('Error de red: ' + url)),
        ontimeout: () => reject(new Error('Timeout: ' + url)),
        timeout: 30000,
      });
    });
  }

  async function stats(path) {
    const url = API + path;
    // primero, igual que la propia web (mismo origen permitido por CORS)
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', federation: 'fcbq' } });
      if (r.ok) return await r.json();
    } catch (_) { /* fallback */ }
    const r = await gm('GET', url, { headers: { Accept: 'application/json', federation: 'fcbq' } });
    if (r.status !== 200 || !r.json) throw new Error(`Estadísticas ${r.status}: ${path}`);
    return r.json;
  }

  function gh(method, path, body) {
    const { token, repo } = cfg();
    return gm(method, `https://api.github.com/repos/${repo}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body,
    }).then(r => {
      if (r.status >= 300) {
        const msg = (r.json && r.json.message) || r.text || '';
        throw new Error(`GitHub ${r.status} ${method} ${path} · ${msg}`);
      }
      return r.json;
    });
  }

  // sha1 de blob git, para no re-subir lo que no ha cambiado
  async function blobSha(text) {
    const bytes = new TextEncoder().encode(text);
    const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head); all.set(bytes, head.length);
    const h = await crypto.subtle.digest('SHA-1', all);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- sync ----------
  let busy = false;

  function teamFromUrl() {
    const m = location.pathname.match(/\/estadistica\/equip\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  async function sync({ force = false } = {}) {
    if (busy) return;
    let c = cfg();
    if (!c.repo || !c.token) { if (!configure()) return; c = cfg(); }
    const urlTeam = teamFromUrl();
    if (urlTeam && urlTeam !== c.team) {
      if (!confirm('Esta página es de otro equipo. ¿Usarlo como equipo a sincronizar?')) return;
      GM_setValue('team', urlTeam); c = cfg();
    }

    busy = true; setBtn('busy');
    try {
      toast('Leyendo estado del repo…');
      const ref = await gh('GET', `/git/ref/heads/${c.branch}`);
      const headSha = ref.object.sha;
      const commit = await gh('GET', `/git/commits/${headSha}`);
      const tree = await gh('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
      const existing = new Map((tree.tree || []).filter(e => e.type === 'blob').map(e => [e.path, e.sha]));

      toast('Descargando equipo…');
      const team = await stats(`/teams/${c.team}/stats`);
      const files = [{ path: 'data/team.json', text: JSON.stringify(team) }];

      const games = team.games || [];
      let n = 0;
      for (const g of games) {
        const path = `data/matches/${g.matchCallUuid}.json`;
        // los partidos ya guardados no se vuelven a pedir, salvo el último o si se fuerza
        const isLast = g === games[games.length - 1];
        if (existing.has(path) && !force && !isLast) continue;
        n++;
        toast(`Partido J${g.matchDayNum} · ${g.opponent && g.opponent.name || ''}`);
        const [st, pbp] = await Promise.all([
          stats(`/matches/${g.matchCallUuid}/stats?currentSeason=true`),
          stats(`/matches/${g.matchCallUuid}/pbp?currentSeason=true`).catch(() => null),
        ]);
        files.push({ path, text: JSON.stringify({ matchCallUuid: g.matchCallUuid, stats: st, pbp }) });
      }

      // solo lo que ha cambiado
      const changed = [];
      for (const f of files) {
        const sha = await blobSha(f.text);
        if (existing.get(f.path) !== sha) changed.push(f);
      }
      if (!changed.length) { toast('Todo al día ✓', 'ok'); setBtn('ok'); return; }

      const index = {
        team: team.header && team.header.team,
        syncedAt: new Date().toISOString(),
        matches: games.map(g => g.matchCallUuid),
      };
      changed.push({ path: 'data/index.json', text: JSON.stringify(index) });

      toast(`Subiendo ${changed.length - 1} archivo(s)…`);
      const newTree = await gh('POST', '/git/trees', {
        base_tree: commit.tree.sha,
        tree: changed.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.text })),
      });
      const newCommit = await gh('POST', '/git/commits', {
        message: `sync: ${games.length} partidos · ${new Date().toLocaleString('es-ES')}`,
        tree: newTree.sha,
        parents: [headSha],
      });
      await gh('PATCH', `/git/refs/heads/${c.branch}`, { sha: newCommit.sha });
      toast(`Sincronizado ✓ (${changed.length - 1} actualizado${changed.length - 1 === 1 ? '' : 's'})`, 'ok');
      setBtn('ok');
    } catch (e) {
      console.error('[Claret Sync]', e);
      toast(e.message || String(e), 'err', 8000);
      setBtn('err');
    } finally {
      busy = false;
    }
  }

  // ---------- UI ----------
  const css = `
  #cs-btn{position:fixed;left:18px;bottom:96px;z-index:2147483646;height:44px;padding:0 16px 0 12px;border-radius:22px;
    border:0;background:#0f1626;color:#fff;font:600 14px/44px system-ui,sans-serif;display:flex;align-items:center;gap:8px;
    box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;transition:transform .15s}
  #cs-btn:hover{transform:translateY(-2px)}
  #cs-btn .d{width:10px;height:10px;border-radius:50%;background:#ff7a1a}
  #cs-btn.busy .d{animation:csp 1s infinite} #cs-btn.ok .d{background:#2fd39a} #cs-btn.err .d{background:#ff5d6c}
  @keyframes csp{50%{opacity:.25}}
  #cs-toast{position:fixed;left:18px;bottom:150px;z-index:2147483647;max-width:340px;padding:10px 14px;border-radius:12px;
    background:#0f1626;color:#e9eef7;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);
    opacity:0;transform:translateY(6px);transition:all .2s;pointer-events:none}
  #cs-toast.show{opacity:1;transform:none} #cs-toast.ok{border-left:4px solid #2fd39a} #cs-toast.err{border-left:4px solid #ff5d6c}`;

  let btn, tst, tTimer;
  function mount() {
    if (document.getElementById('cs-btn')) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    btn = document.createElement('button'); btn.id = 'cs-btn';
    btn.innerHTML = '<span class="d"></span>Sincronizar';
    btn.title = 'Clic: sincronizar · Mayús+clic: forzar todos los partidos';
    btn.addEventListener('click', e => sync({ force: e.shiftKey }));
    tst = document.createElement('div'); tst.id = 'cs-toast';
    document.body.append(btn, tst);
  }
  function setBtn(state) { if (btn) btn.className = state; }
  function toast(msg, kind = '', ms = 3500) {
    if (!tst) return;
    tst.textContent = msg; tst.className = 'show ' + kind;
    clearTimeout(tTimer);
    if (kind) tTimer = setTimeout(() => (tst.className = ''), ms);
  }

  // la web es una SPA: mostramos el botón solo en las páginas de estadísticas
  function tick() {
    const onStats = location.pathname.startsWith('/estadistica/');
    if (onStats) mount();
    const b = document.getElementById('cs-btn');
    if (b) b.style.display = onStats ? 'flex' : 'none';
  }
  tick();
  setInterval(tick, 1000);
})();
