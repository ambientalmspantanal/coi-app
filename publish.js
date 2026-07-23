// =====================================================================
// PUBLICAÇÃO AUTOMÁTICA NO GITHUB
// Envia o snapshot atual (window.COIDatabase) direto para o repositório
// do GitHub via API — dispensa o passo manual de subir arquivos no site.
//
// Fluxo:
//   1. Usuário importa a planilha (mantém-se como está)
//   2. Clica "🚀 Publicar no site"
//   3. Se for a primeira vez, pede: owner, repo, branch, path, token
//      (salvos em localStorage, nunca mais pergunta)
//   4. Faz PUT no arquivo data.json do repo (GitHub Contents API)
//   5. GitHub Pages reflete a mudança em ~30s
// =====================================================================

(function () {
  const CFG_KEY = "coi_github_publish_cfg";
  const STORAGE_KEY = "coi_db";

  // Configuração padrão do repositório do COI — usuário só precisa colar o token.
  const CFG_PADRAO = {
    owner: "ambientalmspantanal",
    repo: "coi-app",
    branch: "main",
    path: "dados.json",
    token: "",
  };

  function carregarCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function salvarCfg(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }
  function limparCfg() {
    localStorage.removeItem(CFG_KEY);
  }

  // Modal simples com prompts encadeados — pede só o que estiver em branco.
  // Repositório do COI já vem configurado; usuário só cola o token.
  function pedirConfig(cfgAtual) {
    const c = { ...CFG_PADRAO, ...(cfgAtual || {}) };
    const tokenExistente = c.token ? " (deixe vazio pra manter o atual)" : "";
    const tokenNovo = prompt(
      `Cole o token do GitHub${tokenExistente}.\n\n` +
      "Como gerar (só primeira vez): github.com/settings/tokens → " +
      "'Generate new token (classic)' → escopo 'repo'.",
      ""
    );
    const token = tokenNovo && tokenNovo.trim() ? tokenNovo.trim() : c.token;
    if (!token) {
      alert("Token é obrigatório para publicar.");
      return null;
    }
    // Permite ajustar campos avançados só se o Alt/opção for pressionado — mantém
    // fluxo simples pra Geisa/Valdecir, mas dá saída se um dia mudar o repo.
    const cfg = { owner: c.owner, repo: c.repo, branch: c.branch, path: c.path, token };
    salvarCfg(cfg);
    return cfg;
  }

  async function getShaAtual(cfg) {
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}?ref=${encodeURIComponent(cfg.branch)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${cfg.token}`,
      },
    });
    if (res.status === 404) return null; // arquivo ainda não existe
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GitHub GET ${res.status}: ${txt.slice(0, 200)}`);
    }
    const j = await res.json();
    return j.sha;
  }

  function bytesEmBase64(str) {
    // Codifica UTF-8 corretamente antes de base64.
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function publicar() {
    let cfg = carregarCfg();
    if (!cfg) {
      cfg = pedirConfig(null);
      if (!cfg) { atualizarStatus("Publicação cancelada.", "warn"); return; }
    }
    if (!window.COIDatabase || !Array.isArray(window.COIDatabase.os) || window.COIDatabase.os.length === 0) {
      alert("Nenhum dado importado ainda — importe uma planilha antes de publicar.");
      return;
    }

    const btn = document.getElementById("btn-publicar-github");
    const textoOriginal = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Publicando..."; }
    atualizarStatus("Publicando snapshot no GitHub...", "info");

    try {
      const sha = await getShaAtual(cfg);
      const payload = JSON.stringify(
        {
          gerado_em: new Date().toISOString(),
          origem: "COI Web (import Excel)",
          coi: window.COIDatabase,
        },
        null,
        2
      );
      const body = {
        message: `Atualização automática ${new Date().toLocaleString("pt-BR")} — ${window.COIDatabase.os.length} OS`,
        content: bytesEmBase64(payload),
        branch: cfg.branch,
      };
      if (sha) body.sha = sha;

      const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`GitHub PUT ${res.status}: ${txt.slice(0, 300)}`);
      }
      atualizarStatus(`✅ Publicado! GitHub Pages atualiza em ~30s.`, "ok");
    } catch (err) {
      console.error(err);
      const msg = String(err.message || err);
      if (msg.includes("401") || msg.includes("Bad credentials")) {
        atualizarStatus("❌ Token inválido — reconfigure.", "err");
        if (confirm("Token do GitHub parece inválido. Refazer configuração?")) {
          limparCfg();
          publicar();
          return;
        }
      } else if (msg.includes("404")) {
        atualizarStatus("❌ Repositório/branch/caminho não encontrado.", "err");
      } else {
        atualizarStatus(`❌ Erro: ${msg.slice(0, 120)}`, "err");
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = textoOriginal || "🚀 Publicar no site"; }
    }
  }

  function reconfigurar() {
    const c = carregarCfg();
    const novo = pedirConfig(c);
    if (novo) atualizarStatus("Configuração salva.", "ok");
  }

  // Publica a lista de usuários (usuarios.json) usando o mesmo token/repo.
  // A lista é lida de window.COIUsersList (expõe do fluxo de Gestão de Usuários)
  // ou aceita como argumento direto — o botão injetado abaixo usa a global.
  async function publicarUsuarios(listaOpcional) {
    let cfg = carregarCfg();
    if (!cfg) {
      cfg = pedirConfig(null);
      if (!cfg) return;
    }
    const lista = listaOpcional || window.COIUsersList;
    if (!Array.isArray(lista) || lista.length === 0) {
      alert("Nenhum usuário para publicar — cadastre pelo menos 1 antes.");
      return;
    }

    const btn = document.getElementById("btn-publicar-usuarios");
    const textoOriginal = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Publicando..."; }

    try {
      const cfgUsuarios = { ...cfg, path: "usuarios.json" };
      const sha = await getShaAtual(cfgUsuarios);
      const payload = JSON.stringify(lista, null, 2);
      const body = {
        message: `Atualização automática de usuários — ${new Date().toLocaleString("pt-BR")} (${lista.length} usuário${lista.length === 1 ? "" : "s"})`,
        content: bytesEmBase64(payload),
        branch: cfg.branch,
      };
      if (sha) body.sha = sha;

      const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/usuarios.json`;
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`GitHub PUT ${res.status}: ${txt.slice(0, 300)}`);
      }
      alert(`✅ Usuários publicados! GitHub Pages atualiza em ~30s.`);
    } catch (err) {
      console.error(err);
      alert(`❌ Falha ao publicar usuários: ${String(err.message || err).slice(0, 200)}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = textoOriginal || "🚀 Publicar usuários no site"; }
    }
  }

  function atualizarStatus(texto, tipo) {
    const el = document.getElementById("publish-status");
    if (!el) return;
    el.textContent = texto;
    el.dataset.tipo = tipo || "info";
  }

  // Injeta botão no topbar assim que o DOM estiver pronto — não altera o
  // layout existente, só acrescenta um controle ao lado do "Importar Planilha".
  function injetarBotao() {
    const importDiv = document.querySelector(".import-control");
    if (!importDiv || document.getElementById("btn-publicar-github")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btn-publicar-github";
    btn.className = "import-btn";
    btn.textContent = "🚀 Publicar no site";
    btn.style.marginLeft = "8px";
    btn.addEventListener("click", publicar);

    // Menu de reconfiguração (⚙️) — só aparece se já houver config salva
    const cog = document.createElement("button");
    cog.type = "button";
    cog.textContent = "⚙️";
    cog.title = "Reconfigurar credenciais do GitHub";
    cog.style.cssText = "background: none; border: none; cursor: pointer; margin-left: 4px; font-size: 14px; opacity: 0.6;";
    cog.addEventListener("click", reconfigurar);

    const status = document.createElement("span");
    status.id = "publish-status";
    status.style.cssText = "margin-left: 10px; font-size: 12px; color: var(--text-secondary);";

    importDiv.appendChild(btn);
    importDiv.appendChild(cog);
    importDiv.appendChild(status);
  }

  // Injeta o botão "🚀 Publicar usuários no site" ao lado do
  // "⬇ Baixar usuarios.json" na tela de Gestão de Usuários.
  // Fica invisível até o usuário abrir essa tela pela 1ª vez.
  function tentarInjetarBotaoUsuarios() {
    const baixarBtn = document.getElementById("baixar-usuarios-btn");
    if (!baixarBtn || document.getElementById("btn-publicar-usuarios")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btn-publicar-usuarios";
    btn.className = "import-btn";
    btn.textContent = "🚀 Publicar usuários no site";
    btn.style.marginLeft = "8px";
    btn.style.backgroundColor = "var(--brand-green, #10b981)";
    btn.style.color = "#fff";
    btn.addEventListener("click", () => publicarUsuarios());

    baixarBtn.parentNode.insertBefore(btn, baixarBtn.nextSibling);
  }

  // Como a tela de Gestão de Usuários pode renderizar após o load,
  // observa o DOM até o botão de baixar aparecer, e aí injeta o de publicar.
  function observarUsuariosTela() {
    if (document.getElementById("baixar-usuarios-btn")) {
      tentarInjetarBotaoUsuarios();
      return;
    }
    const obs = new MutationObserver(() => {
      if (document.getElementById("baixar-usuarios-btn")) {
        tentarInjetarBotaoUsuarios();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    injetarBotao();
    observarUsuariosTela();
  });

  window.COIPublish = { publicar, publicarUsuarios, reconfigurar, limparCfg };
})();
