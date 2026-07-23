// Lógica de Negócio e Controle da SPA (Central de Operações Integradas)

document.addEventListener("DOMContentLoaded", () => {
  // Estado Global da Aplicação
  const state = {
    activeTab: "contratuais",
    filters: {
      period: "all",
      priority: "all",
      supervisor: "all"
    },
    consultaPage: 1,
    consultaPageSize: 10,
    atrasadasPage: 1,
    vencehojePage: 1,
    vencehojeSelectedPolo: null,
    // Referência de tempo oficial do sistema
    currentSystemTime: new Date("2026-07-20T00:00:00Z"),
    selectedOSId: null
  };

  // Serviços EXCLUÍDOS do cálculo de OS Atrasadas (Fiscalização, Pesquisa,
  // Vistoria e similares — não entram no backlog operacional de atraso).
  // Definição confirmada por Valdecir em 20/07/2026.
  const CODIGOS_EXCLUIR_ATRASADAS = new Set([
    121, 141, 142, 143, 144,   // Pesquisa e Notificação Esgoto
    1830,                       // Vistoria de Ligações Irregulares
    5012,                       // (confirmado separadamente)
    5021,                       // Análise Virtual Óleos e Graxas
    5022,                       // Verificação de Roçada
    5024,                       // Verificação de Mau Cheiro
    5071,                       // Verificação de Odor
    5084,                       // Fiscalização da Descarga de Desarenador
    5088,                       // Fiscalização Descarga do Reator Anaeróbio
    5092,                       // Fiscalização Limpeza do DS
    5093,                       // Fiscalização Recirculação do DS
    5339,                       // Fiscalização Manutenção Válvula Corta Chamas
    5342,                       // Fiscalização Mau Cheiro
    5343,                       // Fiscalização Corte de Grama
    5350,                       // Fiscalização Outros Serviço Esgoto
    5362,                       // Registro de Extravasamento
    5368,                       // Fiscalização de ETES
    5369,                       // Fiscalização de EEEBS
    5370                        // Fiscalização Coleta Mensal
  ]);

  // ─── Regras contratuais de prazo por código de serviço ────────────────────────
  // Fonte: tabela oficial de códigos SIGIS + Tabela 8 do 4º Termo Aditivo.
  // Ligação Esgoto = 10 dias úteis · Desobstrução = 24h corridas · Reposição = 5
  // dias úteis (7 em Três Lagoas, Ponta Porã, Douradina, Fátima do Sul).
  // Códigos sem prazo formal (retorno, limpeza de PV) ficam como "sem SLA".
  const CODIGOS_LIGACAO_SLA = new Set([14110,14114,14115,14170,14210,14320,14410,14420,14510,14520,14610,14620,14710,14721,14810,14820,15010,15020]);
  const CODIGOS_DESOBSTRUCAO_SLA = new Set([43000,43001,43002,43100,61400,61600]);
  const CODIGOS_REPOSICAO_SLA = new Set([99550,99551,99552,99553,99554,99555,99556,99557]);
  const CODIGOS_SEM_PRAZO_FORMAL = new Set([44291, 60700, 61800]);
  const PRAZO_LIGACAO_UTEIS = 10;
  const PRAZO_DESOBSTRUCAO_HORAS = 24;
  const PRAZO_REPOSICAO_UTEIS_PADRAO = 5;
  const PRAZO_REPOSICAO_UTEIS_EXCECAO = 7;
  const CIDADES_REPOSICAO_7D = new Set([
    "TRES LAGOAS", "TRÊS LAGOAS",
    "PONTA PORA", "PONTA PORÃ",
    "DOURADINA",
    "FATIMA DO SUL", "FÁTIMA DO SUL",
  ]);

  function normalizarCidade(txt) { return (txt || "").toString().trim().toUpperCase(); }

  // Adiciona N dias úteis (seg-sex) a uma data.
  function addDiasUteis(base, dias) {
    const d = new Date(base);
    let adicionados = 0;
    while (adicionados < dias) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) adicionados++;
    }
    return d;
  }

  // { prazo: Date|null, semSla: boolean } baseado no código do serviço e cidade.
  function calcularPrazoContratual(os) {
    if (!os || !os.data_abertura) return { prazo: null, semSla: true };
    const codigo = Number(os.id_tipo_servico);
    const abertura = new Date(os.data_abertura);
    if (isNaN(abertura.getTime())) return { prazo: null, semSla: true };

    if (CODIGOS_SEM_PRAZO_FORMAL.has(codigo)) return { prazo: null, semSla: true };
    if (CODIGOS_LIGACAO_SLA.has(codigo)) return { prazo: addDiasUteis(abertura, PRAZO_LIGACAO_UTEIS), semSla: false };
    if (CODIGOS_DESOBSTRUCAO_SLA.has(codigo)) return { prazo: new Date(abertura.getTime() + PRAZO_DESOBSTRUCAO_HORAS * 3600 * 1000), semSla: false };
    if (CODIGOS_REPOSICAO_SLA.has(codigo)) {
      const cidade = normalizarCidade(os.municipio);
      const diasUteis = CIDADES_REPOSICAO_7D.has(cidade) ? PRAZO_REPOSICAO_UTEIS_EXCECAO : PRAZO_REPOSICAO_UTEIS_PADRAO;
      return { prazo: addDiasUteis(abertura, diasUteis), semSla: false };
    }
    return { prazo: null, semSla: true };
  }

  // Prazo efetivo p/ SLA: 1) contratual (código+cidade), 2) data_prazo_programada, 3) data_prazo.
  function obterDataPrazoEfetiva(os) {
    const contratual = calcularPrazoContratual(os);
    if (contratual.prazo) return contratual.prazo;
    if (os && os.data_prazo_programada) return new Date(os.data_prazo_programada);
    if (os && os.data_prazo) return new Date(os.data_prazo);
    return null;
  }

  // ─── Helper de mês de referência (YYYY-MM) ────────────────────────────────────
  function chaveMes(dt) {
    if (!dt) return null;
    const d = dt instanceof Date ? dt : new Date(dt);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // Uma OS é considerada "Atrasada" quando:
  // 1. Não está Concluída nem Cancelada
  // 2. O serviço NÃO está na lista de exclusão
  // 3. Passou do prazo efetivo (contratual > data_prazo_programada > data_prazo)
  // Regra definida por Valdecir — mesma lógica usada no Excel para gerar
  // o relatório de atrasadas da operação.
  function isAtrasadaReal(os) {
    if (os.status === "Concluída" || os.status === "Cancelada") return false;
    if (CODIGOS_EXCLUIR_ATRASADAS.has(os.id_tipo_servico)) return false;
    const prazo = obterDataPrazoEfetiva(os);
    if (!prazo) return false;
    return state.currentSystemTime > prazo;
  }

  // Inicialização
  initNavigation();
  initFilters();
  renderAll();

  // Popular selects com dados reais — chamado após cada importação
  function popularFiltros() {
    if (!window.COIDatabase) return;
    const polos = new Set();
    const supervisores = new Set();
    window.COIDatabase.os.forEach(os => {
      if (os.polo && os.polo !== "#N/A" && os.polo.trim() !== "") polos.add(os.polo.trim());
      if (os.supervisor && os.supervisor !== "#N/A" && os.supervisor.trim() !== "") supervisores.add(os.supervisor.trim());
    });

    // Select global de supervisor (topbar)
    const supervisorSelect = document.getElementById("filter-supervisor");
    if (supervisorSelect) {
      const val = supervisorSelect.value;
      supervisorSelect.innerHTML = '<option value="all">Todos os Supervisores</option>';
      Array.from(supervisores).sort().forEach(s => {
        const opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        supervisorSelect.appendChild(opt);
      });
      supervisorSelect.value = supervisores.has(val) ? val : "all";
    }

    // Selects de Polo nas telas Atrasadas e Vence Hoje
    ["atrasadas-search-polo", "vencehoje-search-polo"].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const val = sel.value;
      sel.innerHTML = '<option value="all">Todos os Polos</option>';
      Array.from(polos).sort().forEach(p => {
        const opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        sel.appendChild(opt);
      });
      sel.value = polos.has(val) ? val : "all";
    });

    // Selects de Supervisor nas telas Atrasadas e Vence Hoje
    ["atrasadas-search-supervisor", "vencehoje-search-supervisor"].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const val = sel.value;
      sel.innerHTML = '<option value="all">Todos os Supervisores</option>';
      Array.from(supervisores).sort().forEach(s => {
        const opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        sel.appendChild(opt);
      });
      sel.value = supervisores.has(val) ? val : "all";
    });

    // Equipes na Consulta Operacional
    const searchTecnicoSelect = document.getElementById("search-tecnico");
    if (searchTecnicoSelect) {
      const equipesReais = new Map();
      window.COIDatabase.os.forEach(os => {
        if (os.id_tecnico && os.id_tecnico !== 0) equipesReais.set(os.id_tecnico, `Equipe ${os.id_tecnico}`);
      });
      searchTecnicoSelect.innerHTML = '<option value="all">Todas as Equipes</option>';
      Array.from(equipesReais.entries()).sort((a,b)=>a[0]-b[0]).forEach(([id,nome]) => {
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = nome;
        searchTecnicoSelect.appendChild(opt);
      });
    }
  }

  // Expõe para import.js
  window.popularFiltros = popularFiltros;
  window.renderAll = renderAll;

  // 1. Roteamento e Navegação SPA (FE-001 / RF-012)
  function initNavigation() {
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const tabId = link.getAttribute("data-tab");
        
        // Atualizar links ativos
        navLinks.forEach(l => l.classList.remove("active"));
        link.classList.add("active");
        
        // Alternar containers de telas
        document.querySelectorAll(".page-container").forEach(container => {
          container.classList.remove("active");
        });
        
        const targetContainer = document.getElementById(`${tabId}-page`);
        if (targetContainer) {
          targetContainer.classList.add("active");
        }
        
        state.activeTab = tabId;

        // Filtros globais (Período/Prioridade/Supervisor) só se aplicam às
        // telas que usam getFilteredOSList. Nas telas com filtros próprios
        // ou cálculo sobre a base total, escondê-los evita a impressão de
        // filtro "que não funciona".
        const filterBar = document.querySelector(".topbar .filter-bar");
        if (filterBar) {
          const telasSemFiltroGlobal = ["contratuais", "atrasadas", "vencehoje"];
          filterBar.style.display = telasSemFiltroGlobal.includes(tabId) ? "none" : "";
        }

        renderActivePage();
        // Re-render extra para tela Indicadores Contratuais
        // que tem SVG/gráficos sensíveis ao momento de visibilidade
        if (tabId === "contratuais") {
          setTimeout(() => renderActivePage(), 80);
        }
      });
    });

    // Botão de fechar gaveta de detalhes
    const closeDrawerBtn = document.getElementById("close-drawer");
    if (closeDrawerBtn) {
      closeDrawerBtn.addEventListener("click", closeOSDrawer);
    }
  }

  // 2. Inicialização dos Filtros da Barra Superior (FE-003 / RF-002)
  function initFilters() {
    const periodSelect = document.getElementById("filter-period");
    const prioritySelect = document.getElementById("filter-priority");
    const supervisorSelect = document.getElementById("filter-supervisor");

    const searchTecnicoSelect = document.getElementById("search-tecnico");

    // Popular Filtros de Consulta Operacional (Wireframe 13.2)
    if (window.COIDatabase) {
    if (searchTecnicoSelect) {
        searchTecnicoSelect.innerHTML = '<option value="all">Todas as Equipes</option>';
        // Usa equipes reais das OS importadas (não o mock do database.js)
        const equipesReais = new Map();
        (window.COIDatabase?.os || []).forEach(os => {
          if (os.id_tecnico && os.id_tecnico !== 0) {
            const nome = `Equipe ${os.id_tecnico}`;
            equipesReais.set(os.id_tecnico, nome);
          }
        });
        // Ordenar por número da equipe
        Array.from(equipesReais.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([id, nome]) => {
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = nome;
            searchTecnicoSelect.appendChild(opt);
          });
      }
    }

    // Popular selects de Polo/Supervisor (filtro global + telas OS Atrasadas / OS a Vencer Hoje)
    popularFiltros();

    // Ouvintes de evento filtros globais
    periodSelect?.addEventListener("change", (e) => {
      state.filters.period = e.target.value;
      renderAll();
    });
    prioritySelect?.addEventListener("change", (e) => {
      state.filters.priority = e.target.value;
      renderAll();
    });
    supervisorSelect?.addEventListener("change", (e) => {
      state.filters.supervisor = e.target.value;
      renderAll();
    });

    // Ouvintes de evento filtros da tela de Consulta (Wireframe 13.2)
    // Qualquer alteração de filtro volta a paginação para a página 1
    function onConsultaFilterChange() {
      state.consultaPage = 1;
      renderConsulta();
    }
    document.getElementById("search-os-num")?.addEventListener("input", onConsultaFilterChange);
    document.getElementById("search-cliente")?.addEventListener("input", onConsultaFilterChange);
    searchTecnicoSelect?.addEventListener("change", onConsultaFilterChange);
    document.getElementById("search-status")?.addEventListener("change", onConsultaFilterChange);
    document.getElementById("search-tipo")?.addEventListener("input", onConsultaFilterChange);

    // Paginação da tabela de Consulta
    document.getElementById("consulta-page-prev")?.addEventListener("click", () => {
      if (state.consultaPage > 1) { state.consultaPage--; renderConsulta(); }
    });
    document.getElementById("consulta-page-next")?.addEventListener("click", () => {
      state.consultaPage++;
      renderConsulta();
    });
    document.getElementById("consulta-exportar-btn")?.addEventListener("click", () => {
      exportarConsultaExcel();
      limparFiltrosConsulta();
    });

    document.getElementById("consulta-visualizar-btn")?.addEventListener("click", visualizarRelatorio);
    document.getElementById("consulta-limpar-btn")?.addEventListener("click", limparFiltrosConsulta);

    // Telas OS Atrasadas / OS a Vencer Hoje: filtros + paginação
    function wireSubListControls(prefix, pageStateKey, renderFn) {
      const onFilterChange = () => {
        state[pageStateKey] = 1;
        renderFn();
      };
      document.getElementById(`${prefix}-search-cidade`)?.addEventListener("input", onFilterChange);
      document.getElementById(`${prefix}-search-polo`)?.addEventListener("change", onFilterChange);
      document.getElementById(`${prefix}-search-supervisor`)?.addEventListener("change", onFilterChange);
      document.getElementById(`${prefix}-page-prev`)?.addEventListener("click", () => {
        if (state[pageStateKey] > 1) {
          state[pageStateKey]--;
          renderFn();
        }
      });
      document.getElementById(`${prefix}-page-next`)?.addEventListener("click", () => {
        state[pageStateKey]++;
        renderFn();
      });
    }
    wireSubListControls("atrasadas", "atrasadasPage", renderAtrasadas);

    // Botão "Voltar para Polos" (visão de resumo da tela OS Atrasadas)
    document.getElementById("atrasadas-voltar-btn")?.addEventListener("click", () => {
      const poloSelect = document.getElementById("atrasadas-search-polo");
      if (poloSelect) poloSelect.value = "all";
      state.atrasadasPage = 1;
      renderAtrasadas();
    });
    wireSubListControls("vencehoje", "vencehojePage", renderVenceHoje);

    // Botão "Voltar para Polos" (visão de resumo da tela OS a Vencer Hoje)
    document.getElementById("vencehoje-voltar-btn")?.addEventListener("click", () => {
      const poloSelect = document.getElementById("vencehoje-search-polo");
      if (poloSelect) poloSelect.value = "all";
      state.vencehojePage = 1;
      renderVenceHoje();
    });
  }

  // 3. Filtragem de Dados Base
  function getFilteredOSList() {
    if (!window.COIDatabase) return [];
    
    return window.COIDatabase.os.filter(item => {
      // Filtro de Prioridade
      if (state.filters.priority !== "all" && item.prioridade !== state.filters.priority) {
        return false;
      }
      
      // Filtro de Supervisor
      if (state.filters.supervisor !== "all" && item.supervisor !== state.filters.supervisor) {
        return false;
      }
      
      // Filtro de Período
      if (state.filters.period !== "all") {
        const dateAbertura = new Date(item.data_abertura);
        const timeDiff = state.currentSystemTime.getTime() - dateAbertura.getTime();
        const daysDiff = timeDiff / (1000 * 3600 * 24);
        
        if (state.filters.period === "7d" && daysDiff > 7) {
          return false;
        }
        if (state.filters.period === "month") {
          // Filtrar por Julho de 2026
          const isSameMonth = dateAbertura.getUTCMonth() === 6 && dateAbertura.getUTCFullYear() === 2026;
          if (!isSameMonth) return false;
        }
      }
      
      return true;
    });
  }

  // Helper para buscar nome do cliente
  function getClienteName(id) {
    const c = window.COIDatabase?.clientes.find(item => item.id_cliente === id);
    return c ? c.nome : "Desconhecido";
  }

  // Helper para buscar nome do técnico
  function getTecnicoName(id) {
    const t = window.COIDatabase?.tecnicos.find(item => item.id_tecnico === id);
    return t ? t.nome : "Sem Técnico";
  }

  // Helper para buscar nome do serviço
  function getServicoName(id) {
    const s = window.COIDatabase?.tiposServico.find(item => item.id_tipo_servico === id);
    return s ? s.nome : "Serviço Geral";
  }

  // 4. Regras de SLA e Backlog (BE-002, BE-004)
  // Prioriza o prazo contratual recalculado (código do serviço + cidade)
  // sobre data_prazo_programada e data_prazo importados — os campos da
  // planilha estavam desatualizados frente à Tabela 8 do 4º Termo Aditivo.
  function calculateSLADetails(os) {
    const contratual = calcularPrazoContratual(os);

    // Serviços sem SLA formal (retorno, limpeza PV): não penalizam ninguém.
    if (contratual.semSla && !CODIGOS_LIGACAO_SLA.has(Number(os.id_tipo_servico))
        && !CODIGOS_DESOBSTRUCAO_SLA.has(Number(os.id_tipo_servico))
        && !CODIGOS_REPOSICAO_SLA.has(Number(os.id_tipo_servico))) {
      // Só cai aqui se o código NÃO estiver em nenhuma categoria contratual.
      // Aí ainda tenta usar a fonte da planilha como fallback abaixo.
    }
    if (CODIGOS_SEM_PRAZO_FORMAL.has(Number(os.id_tipo_servico))) {
      return { vencida: false, concluidaNoPrazo: true, semSlaFormal: true };
    }

    const prazoRef = contratual.prazo
      || (os.data_prazo_programada ? new Date(os.data_prazo_programada) : null)
      || (os.data_prazo ? new Date(os.data_prazo) : null);

    if (!prazoRef) {
      return { vencida: false, concluidaNoPrazo: true, semSlaFormal: true };
    }
    if (os.status === "Concluída") {
      const dtConc = os.data_conclusao ? new Date(os.data_conclusao) : null;
      const concluidaNoPrazo = dtConc ? dtConc <= prazoRef : true;
      return { vencida: false, concluidaNoPrazo, semSlaFormal: false };
    }
    if (os.status === "Cancelada") {
      return { vencida: false, concluidaNoPrazo: true, semSlaFormal: false };
    }
    const vencida = state.currentSystemTime > prazoRef;
    return { vencida, concluidaNoPrazo: true, semSlaFormal: false };
  }

  // 5. Renderização Centralizada
  function renderAll() {
    renderActivePage();
  }

  function renderActivePage() {
    switch (state.activeTab) {
      case "dashboard":
        renderDashboard();
        break;
      case "consulta":
        renderConsulta();
        break;
      case "backlog":
        renderBacklog();
        break;
      case "insights":
        renderInsights();
        break;
      case "atrasadas":
        renderAtrasadas();
        break;
      case "vencehoje":
        renderVenceHoje();
        break;
      case "contratuais":
        renderContratuais();
        break;
    }
  }

  // ==========================================
  // TELA 1: DASHBOARD EXECUTIVO (FE-002)
  // ==========================================
  function renderDashboard() {
    popularFiltros();
    const filteredOS = getFilteredOSList();
    
    // Cálculos dos KPIs (Seção 4 / RF-001)
    const totalAbertas = filteredOS.filter(item => item.status !== "Concluída" && item.status !== "Cancelada").length;
    const totalConcluidas = filteredOS.filter(item => item.status === "Concluída").length;
    
    // SLA
    let concluidasNoPrazo = 0;
    let totalAtrasadas = 0;
    
    filteredOS.forEach(os => {
      const { vencida, concluidaNoPrazo } = calculateSLADetails(os);
      if (os.status === "Concluída" && concluidaNoPrazo) concluidasNoPrazo++;
      if (os.status !== "Concluída" && os.status !== "Cancelada" && vencida) totalAtrasadas++;
    });
    
    const slaPercent = totalConcluidas > 0 
      ? Math.round((concluidasNoPrazo / totalConcluidas) * 100) 
      : 100;
      
    // Backlog Acumulado (paradas há mais de 5 dias)
    const backlogAcumuladoCount = filteredOS.filter(os => {
      if (os.status === "Concluída" || os.status === "Cancelada") return false;
      const daysOpen = (state.currentSystemTime - new Date(os.data_abertura)) / (1000 * 3600 * 24);
      return daysOpen > 5;
    }).length;

    // Técnicos Ativos
    const tecnicosAtivos = window.COIDatabase?.tecnicos.filter(t => t.ativo).length || 0;

    // Atualizar HTML dos KPIs
    document.getElementById("kpi-os-abertas").textContent = totalAbertas;
    document.getElementById("kpi-os-concluidas").textContent = totalConcluidas;
    document.getElementById("kpi-sla").textContent = `${slaPercent}%`;
    document.getElementById("kpi-atraso").textContent = totalAtrasadas;
    document.getElementById("kpi-backlog").textContent = backlogAcumuladoCount;

    // Atualizar bolinhas de status
    document.getElementById("sla-status").className = `kpi-status-dot ${slaPercent >= 90 ? 'active' : slaPercent >= 80 ? 'warning' : 'danger'}`;
    document.getElementById("atraso-status").className = `kpi-status-dot ${totalAtrasadas === 0 ? 'active' : totalAtrasadas <= 2 ? 'warning' : 'danger'}`;
    document.getElementById("backlog-status").className = `kpi-status-dot ${backlogAcumuladoCount === 0 ? 'active' : backlogAcumuladoCount <= 2 ? 'warning' : 'danger'}`;

    // Renderizar Gráficos Simulados (RF-003)
    renderStatusChart(filteredOS);
    renderPriorityChart(filteredOS);
    renderTrendChart(filteredOS);
  }

  function renderStatusChart(osList) {
    const container = document.getElementById("status-chart");
    if (!container) return;
    
    const counts = { Aberta: 0, "Em Andamento": 0, Concluída: 0 };
    osList.forEach(os => {
      if (counts[os.status] !== undefined) counts[os.status]++;
    });
    
    const max = Math.max(...Object.values(counts), 1);
    
    container.innerHTML = `
      <div class="chart-simulated-bar">
        <div class="chart-simulated-row">
          <div class="chart-row-label">Aberta</div>
          <div class="chart-row-track"><div class="chart-row-bar" style="width: ${(counts.Aberta / max) * 100}%; background: var(--brand-blue);"></div></div>
          <div class="chart-row-value">${counts.Aberta}</div>
        </div>
        <div class="chart-simulated-row">
          <div class="chart-row-label">Em Andamento</div>
          <div class="chart-row-track"><div class="chart-row-bar" style="width: ${(counts["Em Andamento"] / max) * 100}%; background: #e07b10;"></div></div>
          <div class="chart-row-value">${counts["Em Andamento"]}</div>
        </div>
        <div class="chart-simulated-row">
          <div class="chart-row-label">Concluída</div>
          <div class="chart-row-track"><div class="chart-row-bar" style="width: ${(counts.Concluída / max) * 100}%; background: var(--brand-green);"></div></div>
          <div class="chart-row-value">${counts.Concluída}</div>
        </div>
      </div>
    `;
  }

  function renderPriorityChart(osList) {
    const container = document.getElementById("priority-chart");
    if (!container) return;
    
    const counts = { Alta: 0, Média: 0, Baixa: 0 };
    osList.forEach(os => {
      if (counts[os.prioridade] !== undefined) counts[os.prioridade]++;
    });
    
    const total = osList.length || 1;
    
    container.innerHTML = `
      <div class="chart-simulated-donut">
        <div style="width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, var(--bg-secondary) 55%, transparent 56%), conic-gradient(#c0392b 0% ${Math.round((counts.Alta/total)*100)}%, #e07b10 ${Math.round((counts.Alta/total)*100)}% ${Math.round(((counts.Alta+counts.Média)/total)*100)}%, var(--brand-green) ${Math.round(((counts.Alta+counts.Média)/total)*100)}% 100%); box-shadow: var(--shadow-sm);"></div>
        <div class="donut-legend">
          <div class="legend-item"><span class="legend-color" style="background-color: #c0392b"></span>Alta: ${counts.Alta}</div>
          <div class="legend-item"><span class="legend-color" style="background-color: #e07b10"></span>Média: ${counts.Média}</div>
          <div class="legend-item"><span class="legend-color" style="background-color: var(--brand-green)"></span>Baixa: ${counts.Baixa}</div>
        </div>
      </div>
    `;
  }

  function renderTrendChart(osList) {
    const container = document.getElementById("trend-chart");
    if (!container) return;
    
    // Tendência dos últimos 10 dias (08/07 a 17/07)
    const days = [];
    for (let i = 9; i >= 0; i--) {
      const d = new Date(state.currentSystemTime);
      d.setDate(d.getDate() - i - 1); // Dias anteriores a hoje (18)
      days.push({
        dateStr: d.toISOString().split("T")[0],
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        count: 0
      });
    }
    
    osList.forEach(os => {
      const openingDate = os.data_abertura.split("T")[0];
      const match = days.find(day => day.dateStr === openingDate);
      if (match) match.count++;
    });
    
    const max = Math.max(...days.map(d => d.count), 1);
    
    let html = '<div class="chart-simulated-trend">';
    days.forEach(day => {
      const pct = (day.count / max) * 100;
      html += `
        <div class="trend-bar-col">
          <div class="trend-bar" style="height: ${pct}%">
            <div class="trend-bar-value">${day.count}</div>
          </div>
          <div class="trend-label">${day.label}</div>
        </div>
      `;
    });
    html += "</div>";
    
    container.innerHTML = html;
  }

  // ==========================================
  // TELA 2: CONSULTA OPERACIONAL (FE-004)
  // ==========================================
  async function visualizarRelatorio() {
    if (!window.COIDatabase) return;
    const filteredOS = getFilteredOSList();
    const filterOSNum = document.getElementById("search-os-num")?.value.toLowerCase().trim() || "";
    const filterMatricula = document.getElementById("search-cliente")?.value.toLowerCase().trim() || "";
    const filterTecnico = document.getElementById("search-tecnico")?.value || "all";
    const filterStatus = document.getElementById("search-status")?.value || "all";
    const filterServico = document.getElementById("search-tipo")?.value.toLowerCase().trim() || "";
    const termos = filterServico.split(",").map(t => t.trim()).filter(Boolean);
    const lista = filteredOS.filter(os => {
      if (filterOSNum && !os.numero_os.toLowerCase().includes(filterOSNum)) return false;
      if (filterMatricula && !getClienteName(os.id_cliente).toLowerCase().includes(filterMatricula)) return false;
      if (filterTecnico !== "all" && os.id_tecnico !== parseInt(filterTecnico)) return false;
      if (filterStatus !== "all" && os.status !== filterStatus) return false;
      if (termos.length > 0) {
        const nome = getServicoName(os.id_tipo_servico).toLowerCase();
        const cod = String(os.id_tipo_servico || "");
        if (!termos.some(t => nome.includes(t) || cod.includes(t))) return false;
      }
      return true;
    });
    if (lista.length === 0) { alert("Nenhum registro para visualizar."); return; }

    // Status ORIGINAIS do SIGIS disponíveis na base filtrada
    const statusDisponiveis = [...new Set(lista.map(os => os.situacao_original || os.status))].sort();

    // Modal de seleção de situação (status original SIGIS) antes de abrir o BI
    const statusSelecionados = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';
      const modal = document.createElement('div');
      modal.style.cssText = 'background:#1e293b;border-radius:12px;padding:24px;min-width:340px;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid #334155';
      modal.innerHTML = `
        <div style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">📊 Visualizar Relatório</div>
        <div style="color:#64748b;font-size:12px;margin-bottom:16px">Selecione as Situações a incluir (status original do SIGIS):</div>
        <div id="status-checks" style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
          ${statusDisponiveis.map(st => {
            const cnt = lista.filter(o=>(o.situacao_original||o.status)===st).length;
            // Pré-desmarca as que geralmente não são operacionais
            const desmarcadas = ['Cancelada','Executada (Pré-Baixada)','Baixada (Encerrada)'];
            const checked = !desmarcadas.includes(st) ? 'checked' : '';
            return `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 12px;background:#0f172a;border-radius:8px;border:1px solid #334155">
              <input type="checkbox" value="${st}" ${checked} style="width:16px;height:16px;accent-color:#8dc63f">
              <span style="color:#e2e8f0;font-size:13px;font-weight:500">${st}</span>
              <span style="margin-left:auto;color:#64748b;font-size:11px;white-space:nowrap">${cnt} OS</span>
            </label>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:8px;position:sticky;bottom:0;background:#1e293b;padding-top:8px">
          <button id="btn-cancel-bi" style="flex:1;padding:10px;background:#334155;color:#94a3b8;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Cancelar</button>
          <button id="btn-ok-bi" style="flex:2;padding:10px;background:#8dc63f;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">✓ Gerar Relatório</button>
        </div>
      `;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      document.getElementById('btn-cancel-bi').onclick = () => { document.body.removeChild(overlay); resolve(null); };
      document.getElementById('btn-ok-bi').onclick = () => {
        const sels = [...modal.querySelectorAll('#status-checks input:checked')].map(i => i.value);
        document.body.removeChild(overlay);
        resolve(sels);
      };
    });
    if (!statusSelecionados || statusSelecionados.length === 0) return;
    // Filtra pela situação original do SIGIS
    const listaFiltrada = lista.filter(os => statusSelecionados.includes(os.situacao_original || os.status));
    if (listaFiltrada.length === 0) { alert("Nenhuma OS para os status selecionados."); return; }

    const now = state.currentSystemTime;
    const hoje = now.toLocaleDateString("pt-BR");
    const filtroDesc = termos.length > 0 ? termos.join(", ") : "Todos os serviços";
    function fmtDate(v) { if (!v) return ""; try { return new Date(v).toLocaleDateString("pt-BR"); } catch(e){return "";} }
    function getSit(os) {
      if (os.status === "Concluída" || os.status === "Cancelada") return { sit: os.status, dias: 0, prazo: "" };
      const pr = os.data_prazo_programada ? new Date(os.data_prazo_programada) : (os.data_prazo ? new Date(os.data_prazo) : null);
      if (!pr) return { sit: "SEM PRAZO", dias: 0, prazo: "" };
      const venc = now > pr;
      const dias = Math.floor(Math.abs(now - pr) / 86400000);
      return { sit: venc ? "ATRASADA" : "NO PRAZO", dias, prazo: pr.toLocaleDateString("pt-BR") };
    }
    const proc = listaFiltrada.map(os => { const s = getSit(os); return { ...s, num: os.numero_os, mat: getClienteName(os.id_cliente), mun: os.municipio||"", polo: os.polo||"", sup: os.supervisor||"", serv: getServicoName(os.id_tipo_servico), cod: os.id_tipo_servico||"", eq: getTecnicoName(os.id_tecnico), st: os.status, ab: fmtDate(os.data_abertura) }; });
    const atras = proc.filter(o=>o.sit==="ATRASADA").sort((a,b)=>b.dias-a.dias);
    const okOS  = proc.filter(o=>o.sit==="NO PRAZO").sort((a,b)=>a.prazo.localeCompare(b.prazo));
    const porPolo = {};
    proc.forEach(o => {
      if (o.st==="Concluída"||o.st==="Cancelada") return;
      const p=o.polo||"N/I";
      if(!porPolo[p]) porPolo[p]={sup:o.sup,total:0,at:0,ok:0};
      porPolo[p].total++; if(o.sit==="ATRASADA") porPolo[p].at++; else porPolo[p].ok++;
    });
    const rank = Object.entries(porPolo).sort((a,b)=>b[1].at-a[1].at);
    const pend = proc.filter(o=>!["Concluída","Cancelada"].includes(o.st)).length;
    const taxa = pend>0?(atras.length/pend*100).toFixed(1):"0.0";
    const maxAt = rank.length>0?Math.max(...rank.map(([,d])=>d.at),1):1;

    // Gráfico de barras responsivo — % = participação no total de atrasadas
    // Usa Largest Remainder Method para garantir que a soma = 100%
    const totalAtrasadas = atras.length || 1;
    const rankComPct = rank.map(([polo,d]) => {
      const exactPct = d.at>0?(d.at/totalAtrasadas*100):0;
      return { polo, d, exactPct, floor: Math.floor(exactPct), remainder: exactPct - Math.floor(exactPct) };
    });
    let somaFloor = rankComPct.reduce((s,r)=>s+r.floor, 0);
    let restante = 100 - somaFloor;
    rankComPct.sort((a,b)=>b.remainder-a.remainder);
    rankComPct.forEach((r,i)=>{ r.pctLabel = r.floor + (i < restante ? 1 : 0); });
    rankComPct.sort((a,b)=>b.d.at-a.d.at); // voltar ordem original
    const barsSVG = rankComPct.map(({polo,d,pctLabel},i) => {
      const pctBarra = d.at>0?(d.at/maxAt*100).toFixed(1):0;
      const txInterna = d.total>0?(d.at/d.total*100).toFixed(0):0;
      const cor = txInterna>=50?"#ef4444":txInterna>=25?"#f59e0b":"#22c55e";
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:130px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${polo}</div>
        <div style="flex:1;min-width:0;height:22px;background:#1e293b;border-radius:4px;position:relative;overflow:hidden">
          <div style="width:${pctBarra}%;height:100%;background:${cor};border-radius:4px;transition:width .5s"></div>
          <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:700;color:#fff">${d.at}</span>
        </div>
        <div style="text-align:right;font-size:11px;font-weight:700;color:${cor};flex-shrink:0;min-width:80px">${pctLabel}% do total</div>
      </div>`;
    }).join("");
    const barsH = 0; const w = 420;

    // Donut SVG
    const tot = lista.length, atN = atras.length, okN = okOS.length;
    const r=60, cx=80, cy=80, circ=2*Math.PI*r;
    const pAt = tot>0?atN/tot:0; const pOk = tot>0?okN/tot:0;
    const dashAt = circ*pAt, dashOk = circ*pOk;
    const offAt = 0, offOk = -(circ*pAt);
    const donutSVG = `<svg width="160" height="160" viewBox="0 0 160 160">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1e293b" stroke-width="22"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ef4444" stroke-width="22" stroke-dasharray="${dashAt} ${circ-dashAt}" stroke-dashoffset="${circ*0.25}" transform="rotate(-90 ${cx} ${cy})"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#22c55e" stroke-width="22" stroke-dasharray="${dashOk} ${circ-dashOk}" stroke-dashoffset="${circ*0.25-dashAt}" transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy-8}" text-anchor="middle" font-size="22" font-weight="800" fill="#fff" font-family="Segoe UI,sans-serif">${taxa}%</text>
      <text x="${cx}" y="${cy+12}" text-anchor="middle" font-size="10" fill="#64748b" font-family="Segoe UI,sans-serif">Taxa Atraso</text>
    </svg>`;

    const atrasRows = atras.map((o,i)=>{
      const bg=i%2===0?"rgba(239,68,68,.06)":"transparent";
      const dc=o.dias>30?"#ef4444":o.dias>10?"#f59e0b":"#64748b";
      const badge=o.dias>30?`<span style="background:#ef4444;color:#fff;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700">${o.dias}d</span>`:o.dias>10?`<span style="background:#f59e0b;color:#fff;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700">${o.dias}d</span>`:`<span style="background:#374151;color:#fff;padding:1px 7px;border-radius:999px;font-size:10px">${o.dias}d</span>`;
      return `<tr style="background:${bg}">
        <td style="font-weight:700;color:#8dc63f;font-size:11px">${o.num}</td>
        <td style="font-size:11px">${o.mun}</td><td style="font-size:11px;color:#94a3b8">${o.polo}</td>
        <td style="font-size:11px;color:#94a3b8">${o.sup}</td>
        <td style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.serv}</td>
        <td style="font-size:10px;color:#64748b;text-align:center">${o.ab}</td>
        <td style="font-size:10px;color:#64748b;text-align:center">${o.prazo}</td>
        <td style="text-align:center">${badge}</td>
      </tr>`;
    }).join("");

    const okRows = okOS.map((o,i)=>{
      const bg=i%2===0?"rgba(34,197,94,.06)":"transparent";
      const dc=o.dias<=2?"#ef4444":o.dias<=5?"#f59e0b":"#22c55e";
      const badge=`<span style="background:${dc};color:#fff;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700">${o.dias}d</span>`;
      return `<tr style="background:${bg}">
        <td style="font-weight:700;color:#8dc63f;font-size:11px">${o.num}</td>
        <td style="font-size:11px">${o.mun}</td><td style="font-size:11px;color:#94a3b8">${o.polo}</td>
        <td style="font-size:11px;color:#94a3b8">${o.sup}</td>
        <td style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.serv}</td>
        <td style="font-size:10px;color:#64748b;text-align:center">${o.ab}</td>
        <td style="font-size:10px;color:#64748b;text-align:center">${o.prazo}</td>
        <td style="text-align:center">${badge}</td>
      </tr>`;
    }).join("");

    const listaParaBI = listaFiltrada;
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>COI — Mini BI</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0}
.app{display:flex;flex-direction:column;height:100vh}
/* TOPBAR */
.topbar{background:linear-gradient(90deg,#0e3a5c,#0a2d47);padding:10px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(141,198,63,.3);flex-shrink:0}
.topbar h1{color:#fff;font-size:15px;font-weight:800;letter-spacing:.02em}
.topbar p{color:#64748b;font-size:10px;margin-top:2px}
.actions{display:flex;gap:8px;align-items:center}
.badge-green{background:#8dc63f;color:#fff;font-size:10px;font-weight:700;padding:3px 12px;border-radius:999px}
.btn-pdf{background:transparent;border:1px solid #8dc63f;color:#8dc63f;font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;cursor:pointer}
.btn-pdf:hover{background:#8dc63f;color:#fff}
/* TABS */
.tabs{background:#0b1f36;display:flex;gap:0;padding:0 20px;border-bottom:1px solid #1e293b;flex-shrink:0}
.tab{padding:9px 20px;color:#64748b;font-size:12px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:.15s;display:flex;align-items:center;gap:6px}
.tab.active{color:#8dc63f;border-bottom-color:#8dc63f}
.tab:hover:not(.active){color:#e2e8f0}
.tab .cnt{background:#1e293b;color:#94a3b8;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px}
.tab.active .cnt{background:#8dc63f;color:#fff}
/* BODY */
.body{flex:1;overflow:hidden;display:flex;flex-direction:column;padding:14px 20px;gap:12px;min-height:0}
.panel{display:none;flex:1;overflow:hidden;flex-direction:column;gap:12px;min-height:0}
.panel.active{display:flex}
/* CARDS */
.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;flex-shrink:0}
.card{background:#1e293b;border-radius:10px;padding:12px 16px;position:relative;overflow:hidden;border:1px solid #334155}
.card::before{content:"";position:absolute;top:0;left:0;right:0;height:3px}
.card.c1::before{background:#3b82f6}.card.c2::before{background:#ef4444}
.card.c3::before{background:#22c55e}.card.c4::before{background:#f59e0b}.card.c5::before{background:#a78bfa}
.card .lbl{font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
.card .val{font-size:28px;font-weight:800;margin-top:4px;line-height:1}
.card .sub{font-size:10px;color:#475569;margin-top:3px}
/* GRID RESUMO */
.grid-resumo{display:grid;grid-template-columns:1.4fr minmax(0,380px);gap:12px;flex:1;min-height:0;overflow:hidden}
.grid-resumo-left{display:flex;flex-direction:column;gap:12px;overflow:hidden;min-width:0}
.grid-resumo-right{display:flex;flex-direction:column;gap:12px;overflow:hidden;min-width:0}
@media(max-width:900px){.grid-resumo{grid-template-columns:1fr}.cards{grid-template-columns:repeat(2,1fr)!important}}
@media(max-width:600px){.cards{grid-template-columns:1fr!important}.topbar h1{font-size:12px!important}}
/* BLOCKS */
.block{background:#1e293b;border-radius:10px;border:1px solid #334155;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.block-title{padding:10px 16px;font-weight:700;font-size:12px;color:#fff;background:#0f172a;border-bottom:1px solid #334155;flex-shrink:0;display:flex;align-items:center;gap:8px}
.tbl-wrap{flex:1;overflow-y:auto;min-height:0}
.tbl-wrap::-webkit-scrollbar{width:4px}.tbl-wrap::-webkit-scrollbar-track{background:#0f172a}.tbl-wrap::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}
table{width:100%;border-collapse:collapse;font-size:11.5px}
th{padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:#475569;background:#0f172a;position:sticky;top:0;border-bottom:1px solid #1e293b;white-space:nowrap;text-transform:uppercase;letter-spacing:.05em}
td{padding:7px 12px;border-bottom:1px solid #1e293b;vertical-align:middle}
/* FULL */
.full-panel{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
/* DONUT + STATS */
.donut-block{background:#1e293b;border-radius:10px;border:1px solid #334155;padding:14px;display:flex;align-items:center;gap:16px;flex-shrink:0}
.donut-stats{flex:1;display:flex;flex-direction:column;gap:10px}
.stat-row{display:flex;align-items:center;justify-content:space-between}
.stat-label{font-size:11px;color:#64748b;display:flex;align-items:center;gap:6px}
.stat-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.stat-val{font-size:16px;font-weight:800}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
  .topbar,.tabs,.btn-pdf{display:none}
  .app{height:auto;overflow:visible}
  .body{background:#fff;padding:8px;overflow:visible;height:auto}
  .panel{overflow:visible;height:auto;display:flex!important}
  .block,.card{border-color:#e2e8f0;box-shadow:none;break-inside:avoid}
  .tbl-wrap{overflow:visible;max-height:none}
  .grid-resumo{display:grid}
  .full-panel{height:auto;overflow:visible}
}
</style></head><body>
<div class="app">
  <div class="topbar">
    <div><h1>AMBIENTAL MS PANTANAL — C.O.I</h1><p>Mini BI · Filtro: ${filtroDesc} · ${hoje}</p></div>
    <div class="actions">
      <span class="badge-green">Reposição de Pavimento</span>
      <button class="btn-pdf" onclick="window.print()">🖨 PDF</button>
      <button class="btn-pdf" onclick="exportarMiniBI()" style="margin-left:6px;background:#8dc63f;color:#fff;border-color:#8dc63f">⬇ Excel</button>
    </div>
  </div>
  <div class="tabs">
    <div class="tab active" onclick="sw('resumo',this)">📊 Resumo</div>
    <div class="tab" onclick="sw('atrasadas',this)">⚠ Atrasadas <span class="cnt">${atras.length}</span></div>
    <div class="tab" onclick="sw('noprazo',this)">✅ No Prazo <span class="cnt">${okOS.length}</span></div>
  </div>
  <div class="body">

    <!-- RESUMO -->
    <div class="panel active" id="panel-resumo">
      <div class="cards">
        <div class="card c1"><div class="lbl">Total OS</div><div class="val" style="color:#3b82f6">${listaFiltrada.length}</div><div class="sub">analisadas</div></div>
        <div class="card c2"><div class="lbl">Atrasadas</div><div class="val" style="color:#ef4444">${atras.length}</div><div class="sub">prazo vencido</div></div>
        <div class="card c3"><div class="lbl">No Prazo</div><div class="val" style="color:#22c55e">${okOS.length}</div><div class="sub">dentro do prazo</div></div>
        <div class="card c4"><div class="lbl">Taxa Atraso</div><div class="val" style="color:#f59e0b">${taxa}%</div><div class="sub">do total pendente</div></div>
        <div class="card c5"><div class="lbl">Maior Atraso</div><div class="val" style="color:#a78bfa">${atras[0]?.dias||0}d</div><div class="sub">${atras[0]?.mun||"-"}</div></div>
      </div>
      <div class="grid-resumo">
        <div class="grid-resumo-left">
          <div class="block" style="flex:none">
            <div class="block-title">📊 Atrasadas por Polo <span style="color:#64748b;font-weight:400;font-size:11px">(% = taxa de atraso do polo)</span></div>
            <div style="padding:12px 16px;overflow-y:auto;flex:1">${barsSVG}</div>
          </div>
          <div class="block" style="flex:1;min-height:0">
            <div class="block-title" style="background:#0e3a5c;border-bottom-color:#1e4a6e">📍 Onde Atuar — Ranking por Polo</div>
            <div class="tbl-wrap">
              <table>
                <thead><tr><th>#</th><th>Polo</th><th>Supervisor</th><th style="text-align:center">Total</th><th style="text-align:center">Atrasadas</th><th style="text-align:center">No Prazo</th><th style="text-align:center">Taxa</th><th>Prioridade</th></tr></thead>
                <tbody>${rank.map(([polo,d],i)=>{
                  const tx=d.total>0?(d.at/d.total*100).toFixed(0):0;
                  const cor=tx>=50?"#ef4444":tx>=25?"#f59e0b":"#22c55e";
                  const bg=i%2===0?"rgba(255,255,255,.03)":"transparent";
                  const prior=tx>=50?"🔴 CRÍTICO":tx>=25?"🟡 ATENÇÃO":"🟢 ESTÁVEL";
                  return `<tr style="background:${bg}">
                    <td style="color:#64748b;font-size:10px;font-weight:700">${i+1}º</td>
                    <td style="font-weight:700;font-size:11px">${polo}</td>
                    <td style="font-size:11px;color:#64748b">${d.sup}</td>
                    <td style="text-align:center;font-size:11px">${d.total}</td>
                    <td style="text-align:center;font-weight:800;color:#ef4444">${d.at}</td>
                    <td style="text-align:center;color:#22c55e">${d.ok}</td>
                    <td style="text-align:center">
                      <span style="background:${cor};color:#fff;padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700">${tx}%</span>
                    </td>
                    <td style="font-size:11px;font-weight:700;color:${cor}">${prior}</td>
                  </tr>`;
                }).join("")}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="grid-resumo-right">
          <div class="donut-block">
            ${donutSVG}
            <div class="donut-stats">
              <div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#ef4444"></span>Atrasadas</span><span class="stat-val" style="color:#ef4444">${atras.length}</span></div>
              <div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#22c55e"></span>No Prazo</span><span class="stat-val" style="color:#22c55e">${okOS.length}</span></div>
              <div style="height:1px;background:#334155;margin:4px 0"></div>
              <div class="stat-row"><span class="stat-label" style="color:#64748b">Polo crítico</span><span style="font-size:11px;font-weight:700;color:#ef4444">${rank[0]?.[0]||"-"}</span></div>
              <div class="stat-row"><span class="stat-label" style="color:#64748b">Supervisor</span><span style="font-size:11px;color:#94a3b8">${rank[0]?.[1].sup||"-"}</span></div>
            </div>
          </div>
          <div class="block" style="flex:1">
            <div class="block-title">🔴 Top 10 Mais Críticas</div>
            <div class="tbl-wrap">
              <table>
                <thead><tr><th>Nº OS</th><th>Município</th><th>Polo</th><th>Prazo</th><th>Atraso</th></tr></thead>
                <tbody>${atras.slice(0,10).map((o,i)=>{
                  const bg=i%2===0?"rgba(239,68,68,.05)":"transparent";
                  const dc=o.dias>30?"#ef4444":o.dias>10?"#f59e0b":"#64748b";
                  return `<tr style="background:${bg}"><td style="font-weight:700;color:#8dc63f;font-size:11px">${o.num}</td><td style="font-size:11px">${o.mun}</td><td style="font-size:11px;color:#64748b">${o.polo}</td><td style="font-size:11px;color:#64748b;text-align:center">${o.prazo}</td><td style="text-align:center"><span style="background:${dc};color:#fff;padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700">${o.dias}d</span></td></tr>`;
                }).join("")}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ATRASADAS -->
    <div class="panel" id="panel-atrasadas">
      <div class="full-panel block">
        <div class="block-title" style="background:#7f1d1d;border-bottom-color:#991b1b">⚠ OS ATRASADAS — <span style="color:#fca5a5">${atras.length} ordens</span> <span style="color:#64748b;font-weight:400;font-size:11px">ordenadas do mais crítico</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Nº OS</th><th>Município</th><th>Polo</th><th>Supervisor</th><th>Serviço</th><th>Abertura</th><th>Prazo</th><th>Atraso</th></tr></thead>
            <tbody>${atrasRows}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- NO PRAZO -->
    <div class="panel" id="panel-noprazo">
      <div class="full-panel block">
        <div class="block-title" style="background:#14532d;border-bottom-color:#166534">✅ OS NO PRAZO — <span style="color:#86efac">${okOS.length} ordens</span> <span style="color:#64748b;font-weight:400;font-size:11px">ordenadas pelo prazo mais próximo</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Nº OS</th><th>Município</th><th>Polo</th><th>Supervisor</th><th>Serviço</th><th>Abertura</th><th>Prazo</th><th>Restam</th></tr></thead>
            <tbody>${okRows}</tbody>
          </table>
        </div>
      </div>
    </div>

  </div>
</div>
<script data-bi="1">
function sw(id,el){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('panel-'+id).classList.add('active');
  el.classList.add('active');
}
function exportarMiniBI(){
  if(typeof XLSX==='undefined'){
    // XLSX não disponível no contexto do blob — carregar dinamicamente
    var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=function(){ _doExport(); };
    document.head.appendChild(s);
    return;
  }
  _doExport();
}
function _doExport(){
  var wb=XLSX.utils.book_new();
  var t1=document.querySelector('#panel-resumo .block:last-child table');
  if(!t1) t1=document.querySelector('#panel-resumo table');
  if(t1){var ws1=XLSX.utils.table_to_sheet(t1);XLSX.utils.book_append_sheet(wb,ws1,'Onde Atuar');}
  var t2=document.querySelector('#panel-atrasadas table');
  if(t2){var ws2=XLSX.utils.table_to_sheet(t2);XLSX.utils.book_append_sheet(wb,ws2,'Atrasadas');}
  var t3=document.querySelector('#panel-noprazo table');
  if(t3){var ws3=XLSX.utils.table_to_sheet(t3);XLSX.utils.book_append_sheet(wb,ws3,'No Prazo');}
  var data=new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb,'COI_MiniBI_'+data+'.xlsx');
}
<\/script>
</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  function limparFiltrosConsulta() {
    const hoje = now.toLocaleDateString("pt-BR");
    const filtroDesc = termos.length > 0 ? termos.join(", ") : "Todos os serviços";

    function fmtDate(v) { if (!v) return ""; try { return new Date(v).toLocaleDateString("pt-BR"); } catch(e){return "";} }
    function getSit(os) {
      if (os.status === "Concluída" || os.status === "Cancelada") return { sit: os.status, dias: 0, prazo: "" };
      const pr = os.data_prazo_programada ? new Date(os.data_prazo_programada) : (os.data_prazo ? new Date(os.data_prazo) : null);
      if (!pr) return { sit: "SEM PRAZO", dias: 0, prazo: "" };
      const venc = now > pr;
      const dias = Math.floor(Math.abs(now - pr) / 86400000);
      return { sit: venc ? "ATRASADA" : "NO PRAZO", dias, prazo: pr.toLocaleDateString("pt-BR") };
    }

    const proc = listaFiltrada.map(os => { const s = getSit(os); return { ...s, num: os.numero_os, mat: getClienteName(os.id_cliente), mun: os.municipio||"", polo: os.polo||"", sup: os.supervisor||"", serv: getServicoName(os.id_tipo_servico), cod: os.id_tipo_servico||"", eq: getTecnicoName(os.id_tecnico), st: os.status, ab: fmtDate(os.data_abertura) }; });

    const atras = proc.filter(o=>o.sit==="ATRASADA").sort((a,b)=>b.dias-a.dias);
    const okOS  = proc.filter(o=>o.sit==="NO PRAZO").sort((a,b)=>a.prazo.localeCompare(b.prazo));

    const porPolo = {};
    proc.forEach(o => {
      if (o.st==="Concluída"||o.st==="Cancelada") return;
      const p=o.polo||"N/I";
      if(!porPolo[p]) porPolo[p]={sup:o.sup,total:0,at:0,ok:0};
      porPolo[p].total++; if(o.sit==="ATRASADA") porPolo[p].at++; else porPolo[p].ok++;
    });
    const rank = Object.entries(porPolo).sort((a,b)=>b[1].at-a[1].at);
    const taxa = proc.filter(o=>!["Concluída","Cancelada"].includes(o.st)).length > 0
      ? (atras.length / proc.filter(o=>!["Concluída","Cancelada"].includes(o.st)).length * 100).toFixed(1) : "0.0";

    function rowColor(i, base) { return i%2===0 ? base : ""; }

    const rankRows = rank.map(([polo,d],i) => {
      const tx = d.total>0?(d.at/d.total*100).toFixed(0):0;
      const cor = tx>=50?"#FEE2E2":tx>=25?"#FEF3C7":"#DCFCE7";
      const prior = tx>=50?"🔴 CRÍTICO":tx>=25?"🟡 ATENÇÃO":"🟢 ESTÁVEL";
      const fcor = tx>=50?"#991B1B":tx>=25?"#92400E":"#15803D";
      return `<tr style="background:${cor}">
        <td style="text-align:center;font-weight:700">${i+1}º</td>
        <td style="font-weight:700">${polo}</td><td>${d.sup}</td>
        <td style="text-align:center">${d.total}</td>
        <td style="text-align:center;color:#991B1B;font-weight:700">${d.at}</td>
        <td style="text-align:center;color:#15803D">${d.ok}</td>
        <td style="text-align:center">${tx}%</td>
        <td style="text-align:center;color:${fcor};font-weight:700">${prior}</td>
      </tr>`;
    }).join("");

    const atrasRows = atras.map((o,i) => {
      const bg = i%2===0?"#FEE2E2":"#FFF5F5";
      const dc = o.dias>30?"#991B1B":o.dias>10?"#D97706":"#374151";
      return `<tr style="background:${bg}">
        <td style="font-weight:700">${o.num}</td><td>${o.mat}</td><td>${o.mun}</td>
        <td>${o.polo}</td><td>${o.sup}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${o.serv}</td>
        <td style="text-align:center">${o.cod}</td><td style="text-align:center">${o.st}</td>
        <td style="text-align:center">${o.ab}</td><td style="text-align:center">${o.prazo}</td>
        <td style="text-align:center;font-weight:700;color:${dc}">${o.dias}d</td>
      </tr>`;
    }).join("");

    const okRows = okOS.map((o,i) => {
      const bg = i%2===0?"#DCFCE7":"#F0FDF4";
      return `<tr style="background:${bg}">
        <td style="font-weight:700">${o.num}</td><td>${o.mat}</td><td>${o.mun}</td>
        <td>${o.polo}</td><td>${o.sup}</td>
        <td style="max-width:200px">${o.serv}</td>
        <td style="text-align:center">${o.cod}</td><td style="text-align:center">${o.st}</td>
        <td style="text-align:center">${o.ab}</td><td style="text-align:center">${o.prazo}</td>
        <td style="text-align:center;font-weight:700;color:#15803D">${o.dias}d</td>
      </tr>`;
    }).join("");

    const listaParaBI = listaFiltrada;
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>COI — Relatório ${filtroDesc}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Calibri,sans-serif;background:#F1F5F9;color:#1E293B}
  .header{background:#0E3A5C;color:#fff;padding:20px 32px}
  .header h1{font-size:22px;font-weight:700}
  .header p{font-size:13px;color:#94C5E8;margin-top:4px}
  .sub{background:#8DC63F;color:#fff;padding:8px 32px;font-size:12px;font-weight:600}
  .content{padding:24px 32px;max-width:1400px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:28px}
  .card{background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .card .label{font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.05em}
  .card .value{font-size:32px;font-weight:800;margin-top:6px}
  .section{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:24px;overflow:hidden}
  .section-title{padding:14px 20px;font-weight:700;font-size:14px;color:#fff}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#fff;background:#1A4731;white-space:nowrap}
  td{padding:9px 12px;border-bottom:1px solid #E2E8F0;vertical-align:middle}
  .badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700}
  .at{background:#FEE2E2;color:#991B1B}.ok{background:#DCFCE7;color:#15803D}
  .print-btn{position:fixed;bottom:24px;right:24px;background:#8DC63F;color:#fff;border:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2)}
  @media print{.print-btn{display:none}body{background:#fff}.section{box-shadow:none}}
</style></head><body>
<div class="header">
  <h1>AMBIENTAL MS PANTANAL — C.O.I</h1>
  <p>Relatório de Reposição de Pavimento &nbsp;|&nbsp; Filtro: ${filtroDesc} &nbsp;|&nbsp; ${hoje}</p>
</div>
<div class="sub">Central de Operações Integradas — Gerado automaticamente pelo COI</div>
<div class="content">
  <div class="cards">
    <div class="card"><div class="label">Total OS</div><div class="value" style="color:#1E3A5F">${lista.length}</div></div>
    <div class="card"><div class="label">Atrasadas</div><div class="value" style="color:#DC2626">${atras.length}</div></div>
    <div class="card"><div class="label">No Prazo</div><div class="value" style="color:#15803D">${okOS.length}</div></div>
    <div class="card"><div class="label">Taxa de Atraso</div><div class="value" style="color:#D97706">${taxa}%</div></div>
    <div class="card"><div class="label">Maior Atraso</div><div class="value" style="color:#7C3AED">${atras[0]?.dias||0}d</div></div>
  </div>

  <div class="section">
    <div class="section-title" style="background:#1E3A5F">📍 ONDE ATUAR — SITUAÇÃO POR POLO</div>
    <table><thead><tr><th>#</th><th>Polo</th><th>Supervisor</th><th>Total</th><th>Atrasadas</th><th>No Prazo</th><th>% Atraso</th><th>Prioridade</th></tr></thead>
    <tbody>${rankRows}</tbody></table>
  </div>

  <div class="section">
    <div class="section-title" style="background:#DC2626">⚠ OS ATRASADAS — ${atras.length} ordens (ordenado do mais crítico)</div>
    <table><thead><tr><th>Nº OS</th><th>Matrícula</th><th>Município</th><th>Polo</th><th>Supervisor</th><th>Serviço</th><th>Código</th><th>Status</th><th>Abertura</th><th>Prazo</th><th>Dias Atraso</th></tr></thead>
    <tbody>${atrasRows}</tbody></table>
  </div>

  <div class="section">
    <div class="section-title" style="background:#15803D">✅ OS NO PRAZO — ${okOS.length} ordens (ordenado pelo prazo mais próximo)</div>
    <table><thead><tr><th>Nº OS</th><th>Matrícula</th><th>Município</th><th>Polo</th><th>Supervisor</th><th>Serviço</th><th>Código</th><th>Status</th><th>Abertura</th><th>Prazo</th><th>Dias Restantes</th></tr></thead>
    <tbody>${okRows}</tbody></table>
  </div>

  <p style="font-size:11px;color:#92400E;margin-top:8px">⚠ Prazos calculados pela nova R.O. (4º Termo Aditivo): 99553/99557/99558 = 5 dias úteis (7 dias em Três Lagoas/Ponta Porã/Douradina/Fátima do Sul). 70707 = prazo programado pelo SIGIS.</p>
</div>
<button class="print-btn" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  }

  function limparFiltrosConsulta() {
    ["search-os-num", "search-cliente", "search-tipo"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    ["search-tecnico", "search-status"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "all";
    });
    state.consultaPage = 1;
    renderConsulta();
  }

  function exportarConsultaExcel() {
    if (!window.COIDatabase) return;
    const filteredOS = getFilteredOSList();
    const filterOSNum = document.getElementById("search-os-num")?.value.toLowerCase().trim() || "";
    const filterMatricula = document.getElementById("search-cliente")?.value.toLowerCase().trim() || "";
    const filterTecnico = document.getElementById("search-tecnico")?.value || "all";
    const filterStatus = document.getElementById("search-status")?.value || "all";
    const filterServico = document.getElementById("search-tipo")?.value.toLowerCase().trim() || "";
    const termos = filterServico.split(",").map(t => t.trim()).filter(Boolean);
    const lista = filteredOS.filter(os => {
      if (filterOSNum && !os.numero_os.toLowerCase().includes(filterOSNum)) return false;
      if (filterMatricula && !getClienteName(os.id_cliente).toLowerCase().includes(filterMatricula)) return false;
      if (filterTecnico !== "all" && os.id_tecnico !== parseInt(filterTecnico)) return false;
      if (filterStatus !== "all" && os.status !== filterStatus) return false;
      if (termos.length > 0) {
        const nome = getServicoName(os.id_tipo_servico).toLowerCase();
        const cod = String(os.id_tipo_servico || "");
        if (!termos.some(t => nome.includes(t) || cod.includes(t))) return false;
      }
      return true;
    });
    if (lista.length === 0) { alert("Nenhum registro para exportar com os filtros atuais."); return; }
    const now = state.currentSystemTime;
    const hoje = now.toLocaleDateString("pt-BR");
    const filtroDesc = termos.length > 0 ? termos.join(", ") : "Todos os serviços";
    function fmtDate(v) { if (!v) return ""; try { return new Date(v).toLocaleDateString("pt-BR"); } catch(e){return "";} }
    function getSit(os) {
      if (os.status === "Concluída" || os.status === "Cancelada") return { sit: os.status, dias: 0, prazo: fmtDate(os.data_conclusao) };
      const pr = os.data_prazo_programada ? new Date(os.data_prazo_programada) : (os.data_prazo ? new Date(os.data_prazo) : null);
      if (!pr) return { sit: "SEM PRAZO", dias: 0, prazo: "" };
      const prazoStr = pr.toLocaleDateString("pt-BR");
      const venc = now > pr;
      const dias = Math.floor(Math.abs(now - pr) / 86400000);
      return { sit: venc ? "ATRASADA" : "NO PRAZO", dias, prazo: prazoStr };
    }
    const proc = listaFiltrada.map(os => { const s = getSit(os); return { num: os.numero_os, mat: getClienteName(os.id_cliente), mun: os.municipio||"", polo: os.polo||"", sup: os.supervisor||"", serv: getServicoName(os.id_tipo_servico), cod: os.id_tipo_servico||"", eq: getTecnicoName(os.id_tecnico), st: os.status, ab: fmtDate(os.data_abertura), prazo: s.prazo, conc: fmtDate(os.data_conclusao), sit: s.sit, dias: s.dias }; });
    const atras = proc.filter(o=>o.sit==="ATRASADA").sort((a,b)=>b.dias-a.dias);
    const okOS  = proc.filter(o=>o.sit==="NO PRAZO").sort((a,b)=>a.prazo.localeCompare(b.prazo));
    const porPolo = {};
    proc.forEach(o => { if (o.st==="Concluída"||o.st==="Cancelada") return; const p=o.polo||"N/I"; if(!porPolo[p]) porPolo[p]={sup:o.sup,total:0,at:0,ok:0}; porPolo[p].total++; if(o.sit==="ATRASADA") porPolo[p].at++; else porPolo[p].ok++; });
    const rank = Object.entries(porPolo).sort((a,b)=>b[1].at-a[1].at);
    const wb = XLSX.utils.book_new();
    // ABA 1: RESUMO
    const taxa = proc.filter(o=>!["Concluída","Cancelada"].includes(o.st)).length > 0 ? (atras.length / proc.filter(o=>!["Concluída","Cancelada"].includes(o.st)).length * 100).toFixed(1) : "0.0";
    const r1 = [
      ["AMBIENTAL MS PANTANAL — C.O.I"],
      ["Relatório de Reposição de Pavimento | Filtro: " + filtroDesc + " | " + hoje],
      [],
      ["RESUMO EXECUTIVO","","","",""],
      ["Total OS","Atrasadas","No Prazo","Taxa de Atraso","Maior Atraso"],
      [lista.length, atras.length, okOS.length, taxa+"%", (atras[0]?.dias||0)+" dias"],
      [],
      ["SITUAÇÃO POR POLO — ONDE ATUAR"],
      ["Polo","Supervisor","Total","Atrasadas","No Prazo","% Atraso","Prioridade"],
      ...rank.map(([p,d])=>{ const tx=(d.total>0?(d.at/d.total*100).toFixed(0):0); return [p,d.sup,d.total,d.at,d.ok,tx+"%",tx>=50?"🔴 CRÍTICO":tx>=25?"🟡 ATENÇÃO":"🟢 ESTÁVEL"]; }),
      [],
      ["⚠ Prazos pela nova R.O.: 99553/99557/99558 = 5 dias úteis (7 dias em Três Lagoas/Ponta Porã/Douradina/Fátima do Sul). 70707 = prazo SIGIS."]
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(r1);
    ws1["!cols"]=[30,20,12,14,14,12,14].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws1, "📊 Resumo");
    // ABA 2: ATRASADAS
    const cabA=["Nº OS","Matrícula","Município","Polo","Supervisor","Serviço","Código","Equipe","Status","Data Abertura","Prazo Correto","Dias em Atraso"];
    const ws2 = XLSX.utils.aoa_to_sheet([["⚠ OS ATRASADAS — "+atras.length+" ordens | "+hoje],cabA,...atras.map(o=>[o.num,o.mat,o.mun,o.polo,o.sup,o.serv,o.cod,o.eq,o.st,o.ab,o.prazo,o.dias])]);
    ws2["!cols"]=[16,14,18,16,16,36,8,14,14,14,14,10].map(w=>({wch:w}));
    ws2["!merges"]=[{s:{r:0,c:0},e:{r:0,c:11}}];
    ws2["!autofilter"]={ref:"A2:L2"};
    XLSX.utils.book_append_sheet(wb, ws2, "⚠ ATRASADAS");
    // ABA 3: NO PRAZO
    const cabN=["Nº OS","Matrícula","Município","Polo","Supervisor","Serviço","Código","Equipe","Status","Data Abertura","Prazo Correto","Dias p/ Vencer"];
    const ws3 = XLSX.utils.aoa_to_sheet([["✅ OS NO PRAZO — "+okOS.length+" ordens | "+hoje],cabN,...okOS.map(o=>[o.num,o.mat,o.mun,o.polo,o.sup,o.serv,o.cod,o.eq,o.st,o.ab,o.prazo,o.dias])]);
    ws3["!cols"]=[16,14,18,16,16,36,8,14,14,14,14,10].map(w=>({wch:w}));
    ws3["!merges"]=[{s:{r:0,c:0},e:{r:0,c:11}}];
    ws3["!autofilter"]={ref:"A2:L2"};
    XLSX.utils.book_append_sheet(wb, ws3, "✅ NO PRAZO");
    // ABA 4: ONDE ATUAR
    const ws4 = XLSX.utils.aoa_to_sheet([
      ["📍 ONDE ATUAR — RANKING POR POLO | "+hoje],
      ["Ordenado por taxa de atraso (maior criticidade no topo)"],
      [],
      ["#","Polo","Supervisor","Total OS","Atrasadas","No Prazo","% Atraso","Prioridade"],
      ...rank.map(([p,d],i)=>{ const tx=(d.total>0?(d.at/d.total*100).toFixed(0):0); return [(i+1)+"º",p,d.sup,d.total,d.at,d.ok,tx+"%",tx>=50?"🔴 CRÍTICO":tx>=25?"🟡 ATENÇÃO":"🟢 ESTÁVEL"]; }),
      [],["TABELA PARA GRÁFICO"],["Polo","Atrasadas","No Prazo"],
      ...rank.map(([p,d])=>[p,d.at,d.ok])
    ]);
    ws4["!cols"]=[5,22,18,12,12,12,12,14].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws4, "📍 ONDE ATUAR");
    // ABA 5: TODOS OS DADOS
    const ws5 = XLSX.utils.aoa_to_sheet([["Nº OS","Matrícula","Município","Polo","Supervisor","Serviço","Código","Equipe","Status","Abertura","Prazo","Conclusão","Situação","Dias"],...proc.map(o=>[o.num,o.mat,o.mun,o.polo,o.sup,o.serv,o.cod,o.eq,o.st,o.ab,o.prazo,o.conc,o.sit,o.dias])]);
    ws5["!cols"]=[16,14,18,16,16,36,8,12,12,12,12,12,12,8].map(w=>({wch:w}));
    ws5["!autofilter"]={ref:"A1:N1"};
    XLSX.utils.book_append_sheet(wb, ws5, "📋 Todos os Dados");
    const fArq = termos.length>0?"_"+termos.join("-"):"";
    XLSX.writeFile(wb, "COI_Relatorio"+fArq+"_"+now.toISOString().slice(0,10)+".xlsx");
  }

  function renderConsulta() {
    popularFiltros();
    const container = document.getElementById("consulta-table-body");
    if (!container) return;
    
    const filteredOS = getFilteredOSList();
    
    // Filtros específicos do Wireframe 13.2
    const filterOSNum = document.getElementById("search-os-num")?.value.toLowerCase().trim() || "";
    const filterMatricula = document.getElementById("search-cliente")?.value.toLowerCase().trim() || "";
    const filterTecnico = document.getElementById("search-tecnico")?.value || "all";
    const filterStatus = document.getElementById("search-status")?.value || "all";
    const filterServico = document.getElementById("search-tipo")?.value.toLowerCase().trim() || "";
    
    const finalOSList = filteredOS.filter(os => {
      if (filterOSNum && !os.numero_os.toLowerCase().includes(filterOSNum)) return false;
      if (filterMatricula && !getClienteName(os.id_cliente).toLowerCase().includes(filterMatricula)) return false;
      if (filterTecnico !== "all" && os.id_tecnico !== parseInt(filterTecnico)) return false;
      if (filterStatus !== "all" && os.status !== filterStatus) return false;
      if (filterServico) {
        // Suporte a múltiplos termos separados por vírgula (ex: "99553, 99557, reposição")
        const termos = filterServico.split(",").map(t => t.trim()).filter(Boolean);
        const nomeServico = getServicoName(os.id_tipo_servico).toLowerCase();
        const codigoServico = String(os.id_tipo_servico || "");
        const bate = termos.some(t => nomeServico.includes(t) || codigoServico.includes(t));
        if (!bate) return false;
      }
      return true;
    });

    // Paginação (correção mínima necessária para volumes reais de OS)
    const pageSize = state.consultaPageSize;
    const totalRegistros = finalOSList.length;
    const totalPages = Math.max(1, Math.ceil(totalRegistros / pageSize));
    if (state.consultaPage > totalPages) state.consultaPage = totalPages;
    if (state.consultaPage < 1) state.consultaPage = 1;

    const startIdx = (state.consultaPage - 1) * pageSize;
    const pageOSList = finalOSList.slice(startIdx, startIdx + pageSize);

    updateConsultaPaginationControls(totalRegistros, startIdx, pageOSList.length, totalPages);

    // Injetar linhas na tabela (5 colunas conforme Wireframe 13.2)
    if (pageOSList.length === 0) {
      container.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">Nenhuma Ordem de Serviço localizada para os filtros aplicados.</td></tr>`;
      return;
    }

    container.innerHTML = "";
    pageOSList.forEach(os => {
      const tr = document.createElement("tr");
      
      tr.innerHTML = `
        <td><strong style="color: var(--text-primary)">${os.numero_os}</strong></td>
        <td>${getClienteName(os.id_cliente)}</td>
        <td>${getTecnicoName(os.id_tecnico)}</td>
        <td><span class="badge badge-${os.prioridade.toLowerCase()}">${os.prioridade}</span></td>
        <td><span class="badge badge-${os.status.toLowerCase().replace(" ", "-")}">${os.status}</span></td>
      `;

      tr.addEventListener("click", () => openOSDrawer(os.id_os));
      container.appendChild(tr);
    });
  }

  function updateConsultaPaginationControls(total, startIdx, pageCount, totalPages) {
    const info = document.getElementById("consulta-page-info");
    const prevBtn = document.getElementById("consulta-page-prev");
    const nextBtn = document.getElementById("consulta-page-next");
    if (!info || !prevBtn || !nextBtn) return;

    const from = total === 0 ? 0 : startIdx + 1;
    const to = startIdx + pageCount;
    info.textContent = `Mostrando ${from}–${to} de ${total} · Página ${state.consultaPage} de ${totalPages}`;

    prevBtn.disabled = state.consultaPage <= 1;
    nextBtn.disabled = state.consultaPage >= totalPages;
  }

  // ==========================================
  // TELAS 5 e 6: OS ATRASADAS / OS A VENCER HOJE
  // Reaproveitam o mesmo padrão de tabela paginada da Consulta Operacional.
  // ==========================================
  function renderOSSubList(config) {
    const tbody = document.getElementById(config.tbodyId);
    if (!tbody || !window.COIDatabase) return;

    const cidadeFilter = document.getElementById(config.cidadeInputId)?.value.toLowerCase().trim() || "";
    const poloFilter = document.getElementById(config.poloSelectId)?.value || "all";
    const supervisorFilter = document.getElementById(config.supervisorSelectId)?.value || "all";

    let list = window.COIDatabase.os.filter(config.predicate);
    if (cidadeFilter) list = list.filter(os => (os.municipio || "").toLowerCase().includes(cidadeFilter));
    if (poloFilter !== "all") list = list.filter(os => (os.polo||"").trim().toUpperCase() === poloFilter.trim().toUpperCase());
    if (supervisorFilter !== "all") list = list.filter(os => (os.supervisor||"").trim().toUpperCase() === supervisorFilter.trim().toUpperCase());

    const pageSize = 50;
    let page = state[config.pageStateKey];
    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    state[config.pageStateKey] = page;

    const startIdx = (page - 1) * pageSize;
    const pageList = list.slice(startIdx, startIdx + pageSize);

    const info = document.getElementById(config.pageInfoId);
    const prevBtn = document.getElementById(config.prevBtnId);
    const nextBtn = document.getElementById(config.nextBtnId);
    if (info) {
      const from = list.length === 0 ? 0 : startIdx + 1;
      const to = startIdx + pageList.length;
      info.textContent = `Mostrando ${from}–${to} de ${list.length} · Página ${page} de ${totalPages}`;
    }
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;

    const colCount = config.showDiasAtraso ? 7 : 6;
    if (pageList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; padding: 40px; color: var(--text-muted);">Nenhuma Ordem de Serviço encontrada para os filtros aplicados.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    pageList.forEach(os => {
      const tr = document.createElement("tr");
      const diasAtrasoCol = config.showDiasAtraso
        ? (() => {
            const diasAtraso = os.data_prazo ? Math.floor((state.currentSystemTime - new Date(os.data_prazo)) / (1000 * 3600 * 24)) : null;
            return `<td>${diasAtraso !== null && diasAtraso > 0 ? diasAtraso + "d" : "-"}</td>`;
          })()
        : "";
      tr.innerHTML = `
        <td><strong style="color: var(--text-primary)">${os.numero_os}</strong></td>
        <td>${os.municipio || "-"}</td>
        <td>${os.polo || "-"}</td>
        <td>${os.supervisor || "-"}</td>
        <td>${getServicoName(os.id_tipo_servico)}</td>
        ${diasAtrasoCol}
        <td><span class="badge badge-${os.status.toLowerCase().replace(" ", "-")}">${os.status}</span></td>
      `;
      tr.addEventListener("click", () => openOSDrawer(os.id_os));
      tbody.appendChild(tr);
    });
  }

  // Painel IEA — Indicador de Eficiência no Atendimento (fórmula oficial
  // confirmada pela planilha de referência do contrato):
  // SE (QA/QT ≥ X) ENTÃO IEA = 1,00; SENÃO IEA = QA/QT
  // QT = Total de OS emitidas | QA = OS baixadas dentro do prazo
  // X = 0,93 até o ano 5 de contrato, 0,95 a partir do ano 5.
  // Confirmado por Valdecir: contrato já está no ano 6+ -> X = 0,95.
  function updateIEAPanel() {
    const qtEl = document.getElementById("iea-qt");
    const qaEl = document.getElementById("iea-qa");
    const ratioEl = document.getElementById("iea-ratio");
    const finalEl = document.getElementById("iea-final");
    if (!qtEl || !window.COIDatabase) return;

    const X = 0.95;
    const allOS = window.COIDatabase.os;
    const qt = allOS.length;
    const baixadas = allOS.filter(os => os.status === "Concluída").length;
    // IEA = QA / Total Baixadas (fórmula oficial SIGIS, não QA/QT total)
    const qa = allOS.filter(os => {
      if (os.status !== "Concluída") return false;
      const { concluidaNoPrazo } = calculateSLADetails(os);
      return concluidaNoPrazo;
    }).length;
    const ratio = baixadas > 0 ? qa / baixadas : 0;
    const iea = ratio >= X ? 1 : ratio;

    qtEl.textContent = qt.toLocaleString("pt-BR");
    qaEl.textContent = qa.toLocaleString("pt-BR");
    ratioEl.textContent = (ratio * 100).toFixed(1) + "%";
    finalEl.textContent = iea.toFixed(2).replace(".", ",");
  }

  function renderAtrasadas() {
    // Garante que os selects de Polo/Supervisor estão populados com dados reais
    popularFiltros();
    updateIEAPanel();

    // Painel de Atraso (Taxa de Atraso + Média de Dias) — calculado sobre
    // TODAS as OS atrasadas (não só a página atual), aplicando os mesmos
    // filtros de Cidade/Polo/Supervisor da tela.
    if (window.COIDatabase) {
      const cidadeFilter = document.getElementById("atrasadas-search-cidade")?.value.toLowerCase().trim() || "";
      const poloFilter = document.getElementById("atrasadas-search-polo")?.value || "all";
      const supervisorFilter = document.getElementById("atrasadas-search-supervisor")?.value || "all";

      const pendentes = window.COIDatabase.os.filter(os => os.status !== "Concluída" && os.status !== "Cancelada");
      const pendentesFiltradas = pendentes.filter(os => {
        if (cidadeFilter && !(os.municipio || "").toLowerCase().includes(cidadeFilter)) return false;
        if (poloFilter !== "all" && os.polo !== poloFilter) return false;
        if (supervisorFilter !== "all" && os.supervisor !== supervisorFilter) return false;
        return true;
      });
      const atrasadasFiltradas = pendentesFiltradas.filter(os => isAtrasadaReal(os));

      const taxa = pendentesFiltradas.length > 0 ? (atrasadasFiltradas.length / pendentesFiltradas.length) * 100 : 0;
      const somaDias = atrasadasFiltradas.reduce((acc, os) => {
        if (!os.data_prazo) return acc;
        const dias = (state.currentSystemTime - new Date(os.data_prazo)) / (1000 * 3600 * 24);
        return acc + Math.max(0, dias);
      }, 0);
      const mediaDias = atrasadasFiltradas.length > 0 ? somaDias / atrasadasFiltradas.length : 0;

      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setText("atraso-count", atrasadasFiltradas.length.toLocaleString("pt-BR"));
      setText("atraso-taxa", taxa.toFixed(1).replace(".", ",") + "%");
      setText("atraso-media-dias", mediaDias.toFixed(1).replace(".", ",") + "d");
    }

    // Alterna entre a visão de resumo por Polo (padrão) e a lista de OS
    // de um Polo específico (drill-down, ao clicar num Polo do resumo).
    const poloSelect = document.getElementById("atrasadas-search-polo");
    const poloAtual = poloSelect?.value || "all";
    const summaryTable = document.getElementById("atrasadas-polo-summary-table");
    const osListTable = document.getElementById("atrasadas-os-list-table");
    const paginationBar = document.getElementById("atrasadas-pagination-bar");
    const voltarBtn = document.getElementById("atrasadas-voltar-btn");
    const titulo = document.getElementById("atrasadas-titulo");

    if (poloAtual === "all") {
      // Visão 1: resumo por Polo
      if (summaryTable) summaryTable.style.display = "";
      if (osListTable) osListTable.style.display = "none";
      if (paginationBar) paginationBar.style.display = "none";
      if (voltarBtn) voltarBtn.style.display = "none";
      if (titulo) titulo.textContent = "OS Atrasadas por Polo";
      renderAtrasadasPoloSummary();
    } else {
      // Visão 2: lista de OS do Polo selecionado
      if (summaryTable) summaryTable.style.display = "none";
      if (osListTable) osListTable.style.display = "";
      if (paginationBar) paginationBar.style.display = "";
      if (voltarBtn) voltarBtn.style.display = "";
      if (titulo) titulo.textContent = `OS Atrasadas — ${poloAtual}`;
      renderOSSubList({
        predicate: (os) => os.status !== "Concluída" && os.status !== "Cancelada" && isAtrasadaReal(os),
        tbodyId: "atrasadas-table-body",
        pageInfoId: "atrasadas-page-info",
        prevBtnId: "atrasadas-page-prev",
        nextBtnId: "atrasadas-page-next",
        cidadeInputId: "atrasadas-search-cidade",
        poloSelectId: "atrasadas-search-polo",
        supervisorSelectId: "atrasadas-search-supervisor",
        pageStateKey: "atrasadasPage",
        showDiasAtraso: true
      });
    }
  }

  // Visão de resumo: agrupa as OS atrasadas por Polo (respeitando os
  // filtros de Cidade/Supervisor, mas não o de Polo — é o que está sendo
  // resumido). Clicar num Polo abre a lista de OS daquele Polo.
  function renderAtrasadasPoloSummary() {
    const tbody = document.getElementById("atrasadas-polo-summary-body");
    if (!tbody || !window.COIDatabase) return;

    const cidadeFilter = document.getElementById("atrasadas-search-cidade")?.value.toLowerCase().trim() || "";
    const supervisorFilter = document.getElementById("atrasadas-search-supervisor")?.value || "all";

    const atrasadas = window.COIDatabase.os.filter(os => {
      if (os.status === "Concluída" || os.status === "Cancelada") return false;
      if (!isAtrasadaReal(os)) return false;
      if (cidadeFilter && !(os.municipio || "").toLowerCase().includes(cidadeFilter)) return false;
      if (supervisorFilter !== "all" && os.supervisor !== supervisorFilter) return false;
      return true;
    });

    const porPolo = {};
    atrasadas.forEach(os => {
      const polo = os.polo || "Não informado";
      if (!porPolo[polo]) porPolo[polo] = { total: 0, somaDias: 0, cidades: {} };
      porPolo[polo].total++;
      if (os.data_prazo) {
        const dias = Math.max(0, (state.currentSystemTime - new Date(os.data_prazo)) / (1000 * 3600 * 24));
        porPolo[polo].somaDias += dias;
      }
      const cidade = os.municipio || "Não informado";
      porPolo[polo].cidades[cidade] = (porPolo[polo].cidades[cidade] || 0) + 1;
    });

    const linhas = Object.entries(porPolo)
      .map(([polo, dados]) => {
        const cidadeTop = Object.entries(dados.cidades).sort((a, b) => b[1] - a[1])[0];
        return {
          polo,
          total: dados.total,
          mediaDias: dados.total > 0 ? dados.somaDias / dados.total : 0,
          cidadeCritica: cidadeTop ? `${cidadeTop[0]} (${cidadeTop[1]})` : "-"
        };
      })
      .sort((a, b) => b.total - a.total);

    if (linhas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 40px; color: var(--text-muted);">Nenhuma OS atrasada para os filtros aplicados.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    linhas.forEach(linha => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong style="color: var(--text-primary)">${linha.polo}</strong></td>
        <td><span class="badge badge-atrasada">${linha.total}</span></td>
        <td>${linha.mediaDias.toFixed(1)}d</td>
        <td>${linha.cidadeCritica}</td>
      `;
      tr.addEventListener("click", () => {
        const poloSelect = document.getElementById("atrasadas-search-polo");
        if (poloSelect) poloSelect.value = linha.polo;
        state.atrasadasPage = 1;
        renderAtrasadas();
      });
      tbody.appendChild(tr);
    });
  }

  function isVenceHoje(os) {
    if (os.status === "Concluída" || os.status === "Cancelada") return false;
    if (!os.data_prazo) return false;
    const prazo = new Date(os.data_prazo);
    const hoje = state.currentSystemTime;
    return prazo.getUTCFullYear() === hoje.getUTCFullYear() &&
           prazo.getUTCMonth() === hoje.getUTCMonth() &&
           prazo.getUTCDate() === hoje.getUTCDate();
  }

  function renderVenceHoje() {
    popularFiltros();
    // Painel "Realidade do Momento" — calculado sobre TODAS as OS que vencem
    // hoje, aplicando os mesmos filtros de Cidade/Polo/Supervisor da tela.
    if (window.COIDatabase) {
      const cidadeFilter = document.getElementById("vencehoje-search-cidade")?.value.toLowerCase().trim() || "";
      const poloFilter = document.getElementById("vencehoje-search-polo")?.value || "all";
      const supervisorFilter = document.getElementById("vencehoje-search-supervisor")?.value || "all";

      const venceHojeList = window.COIDatabase.os.filter(os => {
        if (!isVenceHoje(os)) return false;
        if (cidadeFilter && !(os.municipio || "").toLowerCase().includes(cidadeFilter)) return false;
        if (poloFilter !== "all" && os.polo !== poloFilter) return false;
        if (supervisorFilter !== "all" && os.supervisor !== supervisorFilter) return false;
        return true;
      });

      const porCidade = {};
      venceHojeList.forEach(os => {
        const cidade = os.municipio || "Não informado";
        porCidade[cidade] = (porCidade[cidade] || 0) + 1;
      });
      const rankingCidades = Object.entries(porCidade)
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setText("vencehoje-total", venceHojeList.length.toLocaleString("pt-BR"));
      setText("vencehoje-cidades", Object.keys(porCidade).length.toLocaleString("pt-BR"));
      setText("vencehoje-cidade-critica", rankingCidades.length > 0 ? `${rankingCidades[0].nome} (${rankingCidades[0].total})` : "-");

      const rankingContainer = document.getElementById("vencehoje-ranking-cidades");
      if (rankingContainer) {
        if (rankingCidades.length === 0) {
          rankingContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">Nenhuma OS vence hoje para os filtros aplicados.</div>`;
        } else {
          renderInsightList(rankingContainer, rankingCidades.map(c => ({ nome: c.nome, score: c.total })), "score", "OS vencendo hoje");
        }
      }

      // Ranking de Criticidade por Polo (%): (vence hoje no Polo) / (total
      // de OS pendentes do Polo) × 100 — normaliza por tamanho do Polo,
      // diferente do ranking de cidades acima (que é por volume bruto).
      const todosPendentes = window.COIDatabase.os.filter(os => os.status !== "Concluída" && os.status !== "Cancelada");
      const pendentesPorPolo = {};
      todosPendentes.forEach(os => {
        const polo = os.polo || "Não informado";
        pendentesPorPolo[polo] = (pendentesPorPolo[polo] || 0) + 1;
      });
      const venceHojePorPolo = {};
      venceHojeList.forEach(os => {
        const polo = os.polo || "Não informado";
        venceHojePorPolo[polo] = (venceHojePorPolo[polo] || 0) + 1;
      });
      const rankingCriticidade = Object.entries(venceHojePorPolo)
        .map(([polo, total]) => {
          const totalPendentesPolo = pendentesPorPolo[polo] || total;
          const percentual = totalPendentesPolo > 0 ? (total / totalPendentesPolo) * 100 : 0;
          return { nome: `${polo} (${total}/${totalPendentesPolo})`, score: Math.round(percentual * 10) / 10 };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const criticidadeContainer = document.getElementById("vencehoje-ranking-criticidade");
      if (criticidadeContainer) {
        if (rankingCriticidade.length === 0) {
          criticidadeContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">Nenhuma OS vence hoje para os filtros aplicados.</div>`;
        } else {
          renderInsightList(criticidadeContainer, rankingCriticidade, "score", "% do Polo");
        }
      }
    }

    // Alterna entre resumo por Polo (padrão) e a lista de OS de um Polo
    // específico (drill-down, ao clicar num Polo do resumo).
    const poloSelect = document.getElementById("vencehoje-search-polo");
    const poloAtual = poloSelect?.value || "all";
    const summaryTable = document.getElementById("vencehoje-polo-summary-table");
    const osListTable = document.getElementById("vencehoje-os-list-table");
    const paginationBar = document.getElementById("vencehoje-pagination-bar");
    const voltarBtn = document.getElementById("vencehoje-voltar-btn");
    const titulo = document.getElementById("vencehoje-titulo");

    if (poloAtual === "all") {
      if (summaryTable) summaryTable.style.display = "";
      if (osListTable) osListTable.style.display = "none";
      if (paginationBar) paginationBar.style.display = "none";
      if (voltarBtn) voltarBtn.style.display = "none";
      if (titulo) titulo.textContent = "OS a Vencer Hoje por Polo";
      renderVenceHojePoloSummary();
    } else {
      if (summaryTable) summaryTable.style.display = "none";
      if (osListTable) osListTable.style.display = "";
      if (paginationBar) paginationBar.style.display = "";
      if (voltarBtn) voltarBtn.style.display = "";
      if (titulo) titulo.textContent = `OS a Vencer Hoje — ${poloAtual}`;
      renderOSSubList({
        predicate: isVenceHoje,
        tbodyId: "vencehoje-table-body",
        pageInfoId: "vencehoje-page-info",
        prevBtnId: "vencehoje-page-prev",
        nextBtnId: "vencehoje-page-next",
        cidadeInputId: "vencehoje-search-cidade",
        poloSelectId: "vencehoje-search-polo",
        supervisorSelectId: "vencehoje-search-supervisor",
        pageStateKey: "vencehojePage"
      });
    }
  }

  // Visão de resumo: agrupa as OS "vence hoje" por Polo, com percentual de
  // criticidade. Clicar num Polo abre a lista de OS daquele Polo.
  function renderVenceHojePoloSummary() {
    const cardsContainer = document.getElementById("vencehoje-polo-cards");
    const detailPanel = document.getElementById("vencehoje-polo-detail");
    if (!cardsContainer || !window.COIDatabase) return;

    const cidadeFilter = document.getElementById("vencehoje-search-cidade")?.value.toLowerCase().trim() || "";
    const supervisorFilter = document.getElementById("vencehoje-search-supervisor")?.value || "all";

    const aplicaFiltros = (os) => {
      if (cidadeFilter && !(os.municipio || "").toLowerCase().includes(cidadeFilter)) return false;
      if (supervisorFilter !== "all" && os.supervisor !== supervisorFilter) return false;
      return true;
    };

    const venceHoje = window.COIDatabase.os.filter(os => isVenceHoje(os) && aplicaFiltros(os));
    const atrasadas = window.COIDatabase.os.filter(os =>
      os.status !== "Concluída" && os.status !== "Cancelada" &&
      isAtrasadaReal(os) && aplicaFiltros(os)
    );

    // Agrupa por Polo: vence hoje + atrasadas + cidades + amostra de OS
    const porPolo = {};
    const garantePolo = (polo) => {
      if (!porPolo[polo]) porPolo[polo] = { hoje: 0, atraso: 0, cidades: {}, osHoje: [], osAtraso: [] };
      return porPolo[polo];
    };
    venceHoje.forEach(os => {
      const p = garantePolo(os.polo || "Não informado");
      p.hoje++;
      const cidade = os.municipio || "Não informado";
      p.cidades[cidade] = (p.cidades[cidade] || 0) + 1;
      p.osHoje.push(os);
    });
    atrasadas.forEach(os => {
      const p = garantePolo(os.polo || "Não informado");
      p.atraso++;
      p.osAtraso.push(os);
    });

    // Pendentes por polo (para calcular a taxa de atraso proporcional)
    const pendentesPorPolo = {};
    window.COIDatabase.os.forEach(os => {
      if (os.status === "Concluída" || os.status === "Cancelada") return;
      if (!aplicaFiltros(os)) return;
      const polo = os.polo || "Não informado";
      pendentesPorPolo[polo] = (pendentesPorPolo[polo] || 0) + 1;
    });

    // Selo de status pela TAXA DE ATRASO do polo (atrasadas ÷ pendentes):
    // proporcional ao tamanho do polo, para diferenciar de verdade —
    // em valores absolutos, todos os polos ficariam "Crítico".
    // Crítico ≥ 20% · Atenção ≥ 8% · Estável < 8%.
    const classifica = (polo, d) => {
      const pend = pendentesPorPolo[polo] || (d.hoje + d.atraso) || 1;
      const taxa = (d.atraso / pend) * 100;
      if (taxa >= 20) return { classe: "critico", rotulo: "Crítico", taxa };
      if (taxa >= 8) return { classe: "atencao", rotulo: "Atenção", taxa };
      return { classe: "estavel", rotulo: "Estável", taxa };
    };

    const linhas = Object.entries(porPolo)
      .map(([polo, dados]) => ({ polo, ...dados, selo: classifica(polo, dados) }))
      .sort((a, b) => b.selo.taxa - a.selo.taxa);

    if (linhas.length === 0) {
      cardsContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px;">Nenhuma OS vence hoje ou está atrasada para os filtros aplicados.</div>`;
      if (detailPanel) detailPanel.innerHTML = "";
      return;
    }

    // Mantém a seleção anterior se ainda existir; senão seleciona o 1º
    if (!state.vencehojeSelectedPolo || !porPolo[state.vencehojeSelectedPolo]) {
      state.vencehojeSelectedPolo = linhas[0].polo;
    }

    cardsContainer.innerHTML = "";
    linhas.forEach(linha => {
      const card = document.createElement("div");
      card.className = "polo-card" + (linha.polo === state.vencehojeSelectedPolo ? " selected" : "");
      card.innerHTML = `
        <div class="polo-card-header">
          <span class="polo-card-name">${linha.polo}</span>
          <span class="polo-badge polo-badge-${linha.selo.classe}">${linha.selo.rotulo}</span>
        </div>
        <div class="polo-card-stats">Hoje <strong>${linha.hoje}</strong> · Atraso <strong>${linha.atraso}</strong></div>
      `;
      card.addEventListener("click", () => {
        state.vencehojeSelectedPolo = linha.polo;
        renderVenceHojePoloSummary();
      });
      cardsContainer.appendChild(card);
    });

    // Painel lateral do Polo selecionado
    if (detailPanel) {
      const sel = porPolo[state.vencehojeSelectedPolo];
      const cidadeTop = Object.entries(sel.cidades).sort((a, b) => b[1] - a[1])[0];
      const seloSel = classifica(state.vencehojeSelectedPolo, sel);

      let acao;
      if (seloSel.classe === "critico") {
        acao = `Reforçar equipe de campo em ${cidadeTop ? cidadeTop[0] : state.vencehojeSelectedPolo} hoje — atraso acumulado (${sel.atraso} OS) já supera o volume que vence hoje. Prioridade: atacar as atrasadas mais antigas antes que o backlog cresça.`;
      } else if (seloSel.classe === "atencao") {
        acao = `Concentrar atendimento em ${cidadeTop ? cidadeTop[0] : state.vencehojeSelectedPolo} hoje — ${sel.hoje} OS vencem até o fim do dia${sel.atraso > 0 ? ` e ${sel.atraso} já estão em atraso` : ""}. Atuar agora evita que virem atraso amanhã.`;
      } else {
        acao = `Polo sob controle — ${sel.hoje} OS vencem hoje e não há atraso acumulado relevante. Manter o ritmo atual de atendimento.`;
      }

      // Mini-lista de OS: as que vencem hoje primeiro, depois as atrasadas
      const listaOS = [
        ...sel.osHoje.map(os => ({ os, tag: "hoje", rotulo: "vence hoje" })),
        ...sel.osAtraso.map(os => ({ os, tag: "atraso", rotulo: "atrasada" }))
      ].slice(0, 15);

      detailPanel.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
          <div>
            <div class="polo-detail-title-label">Resumo do polo</div>
            <div class="polo-detail-title" style="margin-bottom: 0;">${state.vencehojeSelectedPolo}</div>
          </div>
          <div class="polo-detail-stats" style="margin-bottom: 0; flex: 1; max-width: 600px;">
            <div class="polo-detail-stat">
              <span class="polo-detail-stat-label">Vencendo hoje</span>
              <span class="polo-detail-stat-value">${sel.hoje}</span>
            </div>
            <div class="polo-detail-stat">
              <span class="polo-detail-stat-label">Atrasadas</span>
              <span class="polo-detail-stat-value late">${sel.atraso}</span>
            </div>
            <div class="polo-detail-stat">
              <span class="polo-detail-stat-label">Cidade mais crítica</span>
              <span class="polo-detail-stat-value" style="font-size: 14px;">${cidadeTop ? `${cidadeTop[0]} (${cidadeTop[1]})` : "-"}</span>
            </div>
            <div class="polo-detail-stat">
              <span class="polo-detail-stat-label">Selo</span>
              <span class="polo-badge polo-badge-${seloSel.classe}" style="margin-top: 4px; display: inline-block;">${seloSel.rotulo}</span>
            </div>
          </div>
        </div>
        <div class="polo-detail-acao" style="margin-top: 0; border-top: 1px solid var(--border-color); padding-top: 10px;">
          💡 <strong>Ação recomendada:</strong> ${acao}
        </div>
        <div class="polo-detail-section-label" style="margin-top: 14px;">OS do polo (visão rápida — clique para detalhes)</div>
        <div class="polo-os-mini-list" id="polo-os-mini-list"></div>
        <button type="button" class="import-btn" id="polo-ver-todas-btn" style="margin-top: 12px; width: 100%;">Ver todas as OS deste polo ›</button>
      `;

      const miniList = detailPanel.querySelector("#polo-os-mini-list");
      if (miniList) {
        listaOS.forEach(({ os, tag, rotulo }) => {
          const item = document.createElement("div");
          item.className = "polo-os-mini-item";
          item.innerHTML = `
            <span class="polo-os-mini-num">${os.numero_os}</span>
            <span class="polo-os-mini-serv">${getServicoName(os.id_tipo_servico)}</span>
            <span class="polo-os-mini-tag ${tag}">${rotulo}</span>
          `;
          item.addEventListener("click", () => openOSDrawer(os.id_os));
          miniList.appendChild(item);
        });
        if (sel.osHoje.length + sel.osAtraso.length > 15) {
          const mais = document.createElement("div");
          mais.style.cssText = "text-align: center; padding: 8px; font-size: 11px; color: var(--text-muted);";
          mais.textContent = `+ ${sel.osHoje.length + sel.osAtraso.length - 15} outras — use "Ver todas"`;
          miniList.appendChild(mais);
        }
      }

      detailPanel.querySelector("#polo-ver-todas-btn")?.addEventListener("click", () => {
        const poloSelect = document.getElementById("vencehoje-search-polo");
        if (poloSelect) poloSelect.value = state.vencehojeSelectedPolo;
        state.vencehojePage = 1;
        renderVenceHoje();
      });
    }
  }

  // ==========================================
  // TELA 7: INDICADORES CONTRATUAIS (estilo SIGIS)
  // Reaproveita calculateSLADetails — mesma fonte de verdade usada no
  // Dashboard e no painel IEA da tela OS Atrasadas.
  // ==========================================
  // Códigos por categoria (Tabela 8 do 4º Termo Aditivo) — usados só para
  // agrupar o Tempo Médio de execução por tipo de serviço nesta tela.
  const CODIGOS_LIGACAO = new Set([14110,14114,14115,14170,14210,14320,14410,14420,14510,14520,14610,14620,14710,14721,14810,14820,15010,15020]);
  const CODIGOS_DESOBSTRUCAO = new Set([43000,43001,43002,43100,44291,60700,61400,61600,61800]);
  const CODIGOS_REPOSICAO = new Set([99550,99551,99552,99553,99554,99555,99556,99557]);

  function calcularTempoMedio(allOS, setCodigos, unidade) {
    const concluidasCategoria = allOS.filter(os =>
      os.status === "Concluída" && setCodigos.has(os.id_tipo_servico) && os.data_abertura && os.data_conclusao
    );
    if (concluidasCategoria.length === 0) return "Sem dados";

    const totalMs = concluidasCategoria.reduce((acc, os) => {
      return acc + (new Date(os.data_conclusao) - new Date(os.data_abertura));
    }, 0);
    const mediaMs = totalMs / concluidasCategoria.length;
    const valor = unidade === "HORAS" ? mediaMs / (3600 * 1000) : mediaMs / (24 * 3600 * 1000);
    const sufixo = unidade === "HORAS" ? "h" : "d";
    // Amostra pequena (<3) é sinalizada explicitamente — não é confiável ainda.
    const aviso = concluidasCategoria.length < 3 ? ` (n=${concluidasCategoria.length})` : "";
    return valor.toFixed(1) + sufixo + aviso;
  }

  function renderContratuais() {
    if (!window.COIDatabase || !window.COIDatabase.os || window.COIDatabase.os.length === 0) {
      // Sem dados: limpa os visuais e mostra mensagem
      const gauge = document.getElementById("iea-gauge");
      if (gauge) gauge.style.background = `conic-gradient(var(--bg-tertiary) 360deg)`;
      const gv = document.getElementById("iea-gauge-value");
      if (gv) { gv.textContent = "—"; gv.style.color = "var(--text-muted)"; }
      return;
    }
    // Regra de apuração contratual: IEA reflete só o MÊS CORRENTE.
    // Considera OS abertas (data_abertura) no mês da data de referência do sistema.
    const mesRef = chaveMes(state.currentSystemTime);
    const allOS = window.COIDatabase.os.filter(os => chaveMes(os.data_abertura) === mesRef);
    const X = 0.95;

    let baixadas = 0, qa = 0, pendVencidas = 0, pendNoPrazo = 0;

    allOS.forEach(os => {
      const { vencida, concluidaNoPrazo, semSlaFormal } = calculateSLADetails(os);

      if (os.status === "Concluída") {
        baixadas++;
        // Concluídas com SLA formal seguem calculateSLADetails.
        // Serviços "sem SLA formal" (retorno, limpeza PV) contam como no prazo.
        if (concluidaNoPrazo || semSlaFormal) qa++;
      } else if (os.status !== "Cancelada") {
        // Pendentes: mesma regra da tela OS Atrasadas
        // (exclui serviços fora do IEA como fiscalização/pesquisa)
        if (isAtrasadaReal(os)) {
          pendVencidas++;
        } else {
          pendNoPrazo++;
        }
      }
    });

    const foraDoPrazo = baixadas - qa;
    const pendTotal = pendVencidas + pendNoPrazo;
    const ratio = baixadas > 0 ? qa / baixadas : 0;
    const iea = ratio >= X ? 1 : ratio;
    const qt = allOS.length;

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setText("sigis-qt", qt.toLocaleString("pt-BR"));
    setText("sigis-baixadas", baixadas.toLocaleString("pt-BR"));
    setText("sigis-qa", qa.toLocaleString("pt-BR"));
    setText("sigis-fora-prazo", foraDoPrazo.toLocaleString("pt-BR"));
    setText("sigis-iea", (iea * 100).toFixed(2).replace(".", ",") + "%");
    setText("sigis-pend-total", pendTotal.toLocaleString("pt-BR"));
    setText("sigis-pend-noprazo", pendNoPrazo.toLocaleString("pt-BR"));
    setText("sigis-pend-vencidas", pendVencidas.toLocaleString("pt-BR"));
    try {
      setText("sigis-tempo-desob", calcularTempoMedio(allOS, CODIGOS_DESOBSTRUCAO, "DIAS"));
      setText("sigis-tempo-ligacao", calcularTempoMedio(allOS, CODIGOS_LIGACAO, "DIAS"));
      setText("sigis-tempo-reposicao", calcularTempoMedio(allOS, CODIGOS_REPOSICAO, "DIAS"));
    } catch (err) {
      console.error("Falha ao calcular Tempo Médio:", err);
    }

    // ── Gauge IEA via SVG (funciona com display:none, sem conic-gradient) ──
    try {
      const pct = Math.min(100, ratio * 100);
      const cor = ratio >= X ? "#8dc63f" : (ratio >= X * 0.7 ? "#d4a017" : "#dc2626");
      const r = 54, cx = 70, cy = 70, circ = 2 * Math.PI * r;
      const dash = circ * (pct / 100);
      const gaugeWrap = document.getElementById("iea-gauge");
      if (gaugeWrap) {
        void gaugeWrap.offsetHeight; // força reflow antes de redesenhar
        gaugeWrap.innerHTML = `
          <svg width="140" height="140" viewBox="0 0 140 140" style="display:block;margin:0 auto">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-tertiary,#1e293b)" stroke-width="16"/>
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cor}" stroke-width="16"
              stroke-dasharray="${dash} ${circ - dash}"
              stroke-dashoffset="${circ * 0.25}"
              transform="rotate(-90 ${cx} ${cy})"
              style="transition:stroke-dasharray .6s"/>
            <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="20" font-weight="800"
              fill="${cor}" font-family="Segoe UI,system-ui,sans-serif">
              ${pct.toFixed(1).replace(".", ",")}%
            </text>
            <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="10"
              fill="#64748b" font-family="Segoe UI,system-ui,sans-serif">
              de 95% (meta)
            </text>
          </svg>`;
      }
    } catch (err) {
      console.error("Falha ao renderizar o gauge IEA:", err);
    }

    // ── Situações das OS ──
    // Envolvido em try/catch e com reflow forçado: sem isso, se o container
    // ainda estivesse com layout "preso" da renderização anterior (ex.: import
    // disparado sem troca de aba), o innerHTML era escrito mas o navegador não
    // repintava o bloco, deixando o card visualmente em branco.
    try {
      const situacoesContainer = document.getElementById("contratuais-situacoes-chart");
      if (situacoesContainer) {
        void situacoesContainer.offsetHeight; // força reflow antes de redesenhar
        if (qt === 0) {
          situacoesContainer.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Sem dados importados.</span>';
        } else {
          const porStatus = {};
          allOS.forEach(os => { porStatus[os.status] = (porStatus[os.status] || 0) + 1; });
          const statusOrdenado = Object.entries(porStatus).sort((a, b) => b[1] - a[1]);
          const maxVal = statusOrdenado[0]?.[1] || 1;
          const cores = { "Aberta": "#0a4f8f", "Em Andamento": "#d4a017", "Concluída": "#8dc63f", "Cancelada": "#64748b" };
          situacoesContainer.innerHTML = statusOrdenado.map(([status, total]) => {
            const pctBarra = (total / maxVal) * 100;
            const pctTotal = ((total / qt) * 100).toFixed(1);
            return `<div style="margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                <span style="color:var(--text-secondary);">${status}</span>
                <span style="color:var(--text-primary);font-weight:600;">${total.toLocaleString("pt-BR")} (${pctTotal}%)</span>
              </div>
              <div style="height:10px;background-color:var(--bg-tertiary);border-radius:5px;overflow:hidden;">
                <div style="height:100%;width:${pctBarra}%;background-color:${cores[status]||"#94a3b8"};border-radius:5px;"></div>
              </div></div>`;
          }).join("");
        }
      }
    } catch (err) {
      console.error("Falha ao renderizar 'Situações das OS':", err);
    }

    // ── Barra Pendentes via innerHTML (funciona sem display:visible) ──
    try {
      const pendentesBar = document.getElementById("pendentes-bar-wrap");
      if (pendentesBar) {
        void pendentesBar.offsetHeight; // força reflow antes de redesenhar
        const pctLate = pendTotal > 0 ? (pendVencidas / pendTotal) * 100 : 0;
        const pctOk = 100 - pctLate;
        pendentesBar.innerHTML = `
          <div style="height:14px;border-radius:7px;overflow:hidden;display:flex;margin-bottom:8px">
            <div style="width:${pctOk}%;background:#8dc63f;transition:width .5s"></div>
            <div style="width:${pctLate}%;background:#dc2626;transition:width .5s"></div>
          </div>
          <div style="display:flex;gap:16px;font-size:12px">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#8dc63f;margin-right:4px"></span>
              Dentro do prazo: <strong id="pendentes-legend-ok">${pendNoPrazo.toLocaleString("pt-BR")} (${pctOk.toFixed(1)}%)</strong>
            </span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#dc2626;margin-right:4px"></span>
              Vencidas: <strong id="pendentes-legend-late">${pendVencidas.toLocaleString("pt-BR")} (${pctLate.toFixed(1)}%)</strong>
            </span>
          </div>`;
      }
    } catch (err) {
      console.error("Falha ao renderizar barra de Pendentes:", err);
    }
  }

  // Gaveta lateral de Detalhe da OS (FE-005 / RF-005)
  function openOSDrawer(idOS) {
    const os = window.COIDatabase?.os.find(o => o.id_os === idOS);
    if (!os) return;
    
    state.selectedOSId = idOS;
    
    // Atualizar dados no HTML da gaveta
    document.getElementById("drawer-os-num").textContent = os.numero_os;
    document.getElementById("val-cliente").textContent = getClienteName(os.id_cliente);
    document.getElementById("val-municipio").textContent = os.municipio;
    document.getElementById("val-servico").textContent = getServicoName(os.id_tipo_servico);
    document.getElementById("val-tecnico").textContent = getTecnicoName(os.id_tecnico);

    // Campos extras (mesmo detalhe da tela "Consulta Ordem de Serviço" do SIGIS)
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || "-"; };
    setVal("val-endereco", os.endereco);
    setVal("val-bairro", os.bairro);
    setVal("val-ponto-ref", os.ponto_ref);
    setVal("val-servico-executado", os.servico_executado_texto);
    setVal("val-observacao", os.observacao);
    
    // Prioridade e Status com Badges
    document.getElementById("val-prioridade").innerHTML = `<span class="badge badge-${os.prioridade.toLowerCase()}">${os.prioridade}</span>`;
    document.getElementById("val-status").innerHTML = `<span class="badge badge-${os.status.toLowerCase().replace(" ", "-")}">${os.status}</span>`;
    
    // Datas
    const formatDate = (dStr) => dStr ? new Date(dStr).toLocaleString("pt-BR", {timeZone: "UTC"}) : "-";
    document.getElementById("val-abertura").textContent = formatDate(os.data_abertura);
    document.getElementById("val-prazo").textContent = formatDate(os.data_prazo);
    document.getElementById("val-conclusao").textContent = formatDate(os.data_conclusao);
    setVal("val-prazo-cliente", os.prazo_exec_cliente ? formatDate(os.prazo_exec_cliente) : null);
    setVal("val-inicio-exec", os.data_inicio_exec ? formatDate(os.data_inicio_exec) : null);

    // Histórico de Status da OS
    const historicoContainer = document.getElementById("drawer-historico-status");
    if (historicoContainer) {
      const historicos = window.COIDatabase.historicoStatus.filter(h => h.id_os === idOS);
      if (historicos.length === 0) {
        historicoContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">Sem movimentações registradas.</span>';
      } else {
        let histHtml = '<div style="display: flex; flex-direction: column; gap: 12px; border-left: 2px solid var(--border-color); padding-left: 14px; margin-left: 6px;">';
        historicos.forEach(h => {
          histHtml += `
            <div style="position: relative;">
              <span style="position: absolute; left: -21px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background-color: var(--accent);"></span>
              <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${h.status_anterior} &rarr; ${h.status_novo}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${formatDate(h.data_mudanca)} | por ${h.responsavel}</div>
            </div>
          `;
        });
        histHtml += '</div>';
        historicoContainer.innerHTML = histHtml;
      }
    }

    // Abrir gaveta no CSS
    document.getElementById("os-drawer").classList.add("open");
  }

  function closeOSDrawer() {
    document.getElementById("os-drawer").classList.remove("open");
    state.selectedOSId = null;
  }

  // ==========================================
  // TELA 3: GESTÃO DE BACKLOG (FE-006 / RF-006)
  // ==========================================
  function renderBacklog() {
    popularFiltros();
    const colAlta = document.getElementById("backlog-col-alta");
    const colMedia = document.getElementById("backlog-col-media");
    const colBaixa = document.getElementById("backlog-col-baixa");
    
    if (!colAlta || !colMedia || !colBaixa) return;
    
    // Filtrar OSs que se enquadram como Backlog_Item: não concluídas/canceladas
    // E paradas há mais de 5 dias (mesmo critério do KPI "Backlog Acumulado" do
    // Dashboard, Seção 4 do master) — evita a tela de Backlog listar tudo que
    // está "Em Aberto", que é um conjunto maior e diferente.
    const filteredOS = getFilteredOSList().filter(os => {
      if (os.status === "Concluída" || os.status === "Cancelada") return false;
      const daysOpen = (state.currentSystemTime - new Date(os.data_abertura)) / (1000 * 3600 * 24);
      return daysOpen > 5;
    });
    
    // Limpar colunas
    colAlta.innerHTML = "";
    colMedia.innerHTML = "";
    colBaixa.innerHTML = "";

    const counts = { Alta: 0, Média: 0, Baixa: 0 };

    filteredOS.forEach(os => {
      const daysOpen = Math.floor((state.currentSystemTime - new Date(os.data_abertura)) / (1000 * 3600 * 24));
      const { vencida } = calculateSLADetails(os);
      
      const card = document.createElement("div");
      card.className = "backlog-item-card";
      
      const slaLabel = vencida 
        ? `<span class="badge badge-atrasada" style="font-size: 9px; padding: 2px 6px;">Atrasada</span>`
        : `<span class="badge badge-no-prazo" style="font-size: 9px; padding: 2px 6px;">No Prazo</span>`;

      card.innerHTML = `
        <div class="backlog-item-header">
          <strong>${os.numero_os}</strong>
          ${slaLabel}
        </div>
        <div class="backlog-item-body">
          <div style="font-weight: 500; margin-bottom: 4px; color: var(--text-primary);">${getServicoName(os.id_tipo_servico)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${getClienteName(os.id_cliente)}</div>
        </div>
        <div class="backlog-item-footer">
          <span>${os.municipio}</span>
          <span style="font-weight: 600; color: ${vencida ? 'var(--danger)' : 'var(--text-secondary)'};">${daysOpen} dias parado</span>
        </div>
      `;

      card.addEventListener("click", () => openOSDrawer(os.id_os));

      // Direcionar para a coluna correta
      if (os.prioridade === "Alta") {
        colAlta.appendChild(card);
        counts.Alta++;
      } else if (os.prioridade === "Média") {
        colMedia.appendChild(card);
        counts.Média++;
      } else {
        colBaixa.appendChild(card);
        counts.Baixa++;
      }
    });

    // Atualizar contadores no cabeçalho das colunas
    document.getElementById("backlog-count-alta").textContent = counts.Alta;
    document.getElementById("backlog-count-media").textContent = counts.Média;
    document.getElementById("backlog-count-baixa").textContent = counts.Baixa;

    // Se a coluna estiver vazia, exibir aviso
    const emptyMsg = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px; border: 1px dashed var(--border-color); border-radius: var(--radius-md);">Sem itens nesta prioridade</div>`;
    if (counts.Alta === 0) colAlta.innerHTML = emptyMsg;
    if (counts.Média === 0) colMedia.innerHTML = emptyMsg;
    if (counts.Baixa === 0) colBaixa.innerHTML = emptyMsg;
  }

  // ==========================================
  // TELA 4: INSIGHTS OPERACIONAIS (FE-007)
  // ==========================================
  function renderInsights() {
    popularFiltros();
    const listMunicipios = document.getElementById("insights-municipios");
    const listServicos = document.getElementById("insights-servicos");
    const listEquipes = document.getElementById("insights-equipes");
    
    if (!listMunicipios || !listServicos || !listEquipes) return;

    const filteredOS = getFilteredOSList();

    // 1. Ranking de Municípios Críticos (RF-008: atraso + backlog)
    const municipiosData = {};
    filteredOS.forEach(os => {
      if (!municipiosData[os.municipio]) {
        municipiosData[os.municipio] = { nome: os.municipio, score: 0, total: 0 };
      }
      municipiosData[os.municipio].total++;
      const { vencida } = calculateSLADetails(os);
      if (os.status !== "Concluída" && os.status !== "Cancelada") {
        // Pesa 1 ponto por estar aberta, e +2 pontos se estiver em atraso (crítica)
        municipiosData[os.municipio].score += 1;
        if (vencida) municipiosData[os.municipio].score += 2;
      }
    });

    const rankMunicipios = Object.values(municipiosData)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    renderInsightList(listMunicipios, rankMunicipios, "score", "pontos de atraso");

    // 2. Ranking de Serviços Críticos (RF-009: atraso + backlog)
    const servicosData = {};
    filteredOS.forEach(os => {
      const servicoNome = getServicoName(os.id_tipo_servico);
      if (!servicosData[servicoNome]) {
        servicosData[servicoNome] = { nome: servicoNome, score: 0, total: 0 };
      }
      servicosData[servicoNome].total++;
      const { vencida } = calculateSLADetails(os);
      if (os.status !== "Concluída" && os.status !== "Cancelada") {
        servicosData[servicoNome].score += 1;
        if (vencida) servicosData[servicoNome].score += 2;
      }
    });

    const rankServicos = Object.values(servicosData)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    renderInsightList(listServicos, rankServicos, "score", "pontos de atraso");

    // 3. Ranking de Produtividade/Equipes Críticas (RF-010)
    // Produtividade: concluídas no prazo / Equipes críticas: maior volume de pendentes/atrasadas
    const equipesData = {};
    filteredOS.forEach(os => {
      const tecnicoNome = getTecnicoName(os.id_tecnico);
      if (tecnicoNome === "Sem Técnico") return; // Ignorar OS sem técnico atribuído
      
      if (!equipesData[tecnicoNome]) {
        equipesData[tecnicoNome] = { nome: tecnicoNome, concluidaPrazo: 0, totalConcluida: 0, scoreAtraso: 0 };
      }
      
      const { vencida, concluidaNoPrazo } = calculateSLADetails(os);
      if (os.status === "Concluída") {
        equipesData[tecnicoNome].totalConcluida++;
        if (concluidaNoPrazo) equipesData[tecnicoNome].concluidaPrazo++;
      } else if (os.status !== "Cancelada") {
        equipesData[tecnicoNome].scoreAtraso += vencida ? 3 : 1;
      }
    });

    const rankEquipes = Object.values(equipesData)
      .map(item => {
        // Eficiência: OS concluídas no prazo %, mas se não concluiu nada, é 0
        const efpct = item.totalConcluida > 0 ? Math.round((item.concluidaPrazo / item.totalConcluida) * 100) : 0;
        return {
          nome: item.nome,
          score: item.scoreAtraso, // Ordenamos pelo volume de atraso (para indicar quem está mais sobrecarregado/crítico)
          extraLabel: `${efpct}% SLA Cumprido (${item.totalConcluida} OS concl.)`
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    renderInsightList(listEquipes, rankEquipes, "score", "pontos de sobrecarga");
  }

  function renderInsightList(container, rankingData, valueKey, labelSuffix) {
    if (rankingData.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">Sem dados para gerar ranking.</div>`;
      return;
    }

    const maxVal = Math.max(...rankingData.map(item => item[valueKey]), 1);

    container.innerHTML = "";
    rankingData.forEach(item => {
      const row = document.createElement("div");
      row.style.marginBottom = "16px";
      
      const pct = (item[valueKey] / maxVal) * 100;
      const extraInfo = item.extraLabel ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${item.extraLabel}</div>` : "";

      row.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; font-size: 13px;">
          <strong style="color: var(--text-primary);">${item.nome}</strong>
          <span style="font-weight: 600; color: ${item[valueKey] > 0 ? 'var(--danger)' : 'var(--text-secondary)'};">${item[valueKey]} ${labelSuffix}</span>
        </div>
        <div class="chart-row-track" style="height: 8px;">
          <div class="chart-row-bar" style="width: ${pct}%; background: ${item[valueKey] > 0 ? 'linear-gradient(90deg, var(--danger) 0%, hsl(350, 89%, 50%) 100%)' : 'var(--success)'};"></div>
        </div>
        ${extraInfo}
      `;
      container.appendChild(row);
    });
  }
});
