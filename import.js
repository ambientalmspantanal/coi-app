// =====================================================================
// IMPORTAÇÃO REAL DE PLANILHA EXCEL (COI)
// Lê a aba "RELATORIO" (mesmo layout de RELATORIO_IDEAL.xlsx / aba RAIZ),
// converte para o formato de window.COIDatabase já usado por app.js/
// database.js, persiste em localStorage e re-renderiza o Dashboard.
//
// Não altera a estrutura de dados existente (clientes/tecnicos/
// tiposServico/os/historicoStatus) — apenas passa a populá-la com
// dados reais em vez do mock fixo de database.js.
// =====================================================================

(function () {
  const STORAGE_KEY = "coi_db";
  const BASE_STORAGE_KEY = "coi_base_regional";

  // Base de Regionais embutida (Cidade → Polo/Supervisor/Regional).
  // Gerada a partir do arquivo Base_Polos.xls — 70 cidades do MS.
  // Usada como fallback quando nenhum arquivo de Base for importado,
  // permitindo importar só a planilha de OS (sem arquivo separado).
  const BASE_REGIONAL_EMBUTIDA = {"ANASTACIO":{"polo":"AQUIDAUANA","supervisor":"ANTONIO","regional":"CORUMBA"},"AQUIDAUANA":{"polo":"AQUIDAUANA","supervisor":"ANTONIO","regional":"CORUMBA"},"DOIS IRMAOS DO BURITI":{"polo":"AQUIDAUANA","supervisor":"ANTONIO","regional":"CORUMBA"},"MIRANDA":{"polo":"AQUIDAUANA","supervisor":"ANTONIO","regional":"CORUMBA"},"TERENOS":{"polo":"AQUIDAUANA","supervisor":"ANTONIO","regional":"CORUMBA"},"BODOQUENA":{"polo":"AQUIDAUANA","supervisor":"ANTONIO","regional":"CORUMBA"},"CORUMBA":{"polo":"CORUMBA","supervisor":"LUIZ MARCIO","regional":"CORUMBA"},"LADARIO":{"polo":"CORUMBA","supervisor":"LUIZ MARCIO","regional":"CORUMBA"},"ALCINOPOLIS":{"polo":"COXIM","supervisor":"LUCAS GALINDO","regional":"TRES LAGOAS"},"CAMAPUA":{"polo":"COXIM","supervisor":"LUCAS GALINDO","regional":"TRES LAGOAS"},"COXIM":{"polo":"COXIM","supervisor":"LUCAS GALINDO","regional":"TRES LAGOAS"},"FIGUEIRAO":{"polo":"COXIM","supervisor":"LUCAS GALINDO","regional":"TRES LAGOAS"},"PEDRO GOMES":{"polo":"COXIM","supervisor":"LUCAS GALINDO","regional":"TRES LAGOAS"},"RIO NEGRO":{"polo":"COXIM","supervisor":"LUCAS GALINDO","regional":"TRES LAGOAS"},"RIO VERDE DE MATO GROSSO":{"polo":"COXIM","supervisor":"LUCAS GALINDO","regional":"TRES LAGOAS"},"SONORA":{"polo":"COXIM","supervisor":"LUCAS GALINDO","regional":"TRES LAGOAS"},"DOURADINA":{"polo":"DOURADOS","supervisor":"DOUGLAS CUNHA","regional":"DOURADOS"},"DOURADOS":{"polo":"DOURADOS","supervisor":"DOUGLAS CUNHA","regional":"DOURADOS"},"FATIMA DO SUL":{"polo":"DOURADOS","supervisor":"DOUGLAS CUNHA","regional":"DOURADOS"},"ITAPORA":{"polo":"DOURADOS","supervisor":"DOUGLAS CUNHA","regional":"DOURADOS"},"MARACAJU":{"polo":"DOURADOS","supervisor":"DOUGLAS CUNHA","regional":"DOURADOS"},"NOVA ALVORADA DO SUL":{"polo":"DOURADOS","supervisor":"DOUGLAS CUNHA","regional":"DOURADOS"},"RIO BRILHANTE":{"polo":"DOURADOS","supervisor":"DOUGLAS CUNHA","regional":"DOURADOS"},"VICENTINA":{"polo":"DOURADOS","supervisor":"DOUGLAS CUNHA","regional":"DOURADOS"},"BONITO":{"polo":"JARDIM","supervisor":"OLIVER","regional":"CORUMBA"},"CARACOL":{"polo":"JARDIM","supervisor":"OLIVER","regional":"CORUMBA"},"GUIA LOPES DA LAGUNA":{"polo":"JARDIM","supervisor":"OLIVER","regional":"CORUMBA"},"JARDIM":{"polo":"JARDIM","supervisor":"OLIVER","regional":"CORUMBA"},"NIOAQUE":{"polo":"JARDIM","supervisor":"OLIVER","regional":"CORUMBA"},"PORTO MURTINHO":{"polo":"JARDIM","supervisor":"OLIVER","regional":"CORUMBA"},"SIDROLANDIA":{"polo":"JARDIM","supervisor":"OLIVER","regional":"CORUMBA"},"CAARAPO":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"ELDORADO":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"IGUATEMI":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"ITAQUIRAI":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"JAPORA":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"JUTI":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"MUNDO NOVO":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"NAVIRAI":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"SETE QUEDAS":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"TACURU":{"polo":"NAVIRAI","supervisor":"JULIO","regional":"NAVIRAI"},"ANAURILANDIA":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"ANGELICA":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"BATAYPORA":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"DEODAPOLIS":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"IVINHEMA":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"JATEI":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"NOVA ANDRADINA":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"NOVA ESPERANCA":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"NOVO HORIZONTE DO SUL":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"TAQUARUSSU":{"polo":"NOVA ANDRADINA","supervisor":"LUCIANO","regional":"NAVIRAI"},"APARECIDA DO TABOADO":{"polo":"PARANAIBA","supervisor":"THIAGO ZUQUE","regional":"TRES LAGOAS"},"CHAPADAO DO SUL":{"polo":"PARANAIBA","supervisor":"THIAGO ZUQUE","regional":"TRES LAGOAS"},"INOCENCIA":{"polo":"PARANAIBA","supervisor":"THIAGO ZUQUE","regional":"TRES LAGOAS"},"PARANAIBA":{"polo":"PARANAIBA","supervisor":"THIAGO ZUQUE","regional":"TRES LAGOAS"},"SELVIRIA":{"polo":"PARANAIBA","supervisor":"THIAGO ZUQUE","regional":"TRES LAGOAS"},"AMAMBAI":{"polo":"PONTA PORA","supervisor":"GERSON","regional":"DOURADOS"},"ANTONIO JOAO":{"polo":"PONTA PORA","supervisor":"GERSON","regional":"DOURADOS"},"ARAL MOREIRA":{"polo":"PONTA PORA","supervisor":"GERSON","regional":"DOURADOS"},"CORONEL SAPUCAIA":{"polo":"PONTA PORA","supervisor":"GERSON","regional":"DOURADOS"},"LAGUNA CARAPA":{"polo":"PONTA PORA","supervisor":"GERSON","regional":"DOURADOS"},"PARANHOS":{"polo":"PONTA PORA","supervisor":"GERSON","regional":"DOURADOS"},"PONTA PORA":{"polo":"PONTA PORA","supervisor":"GERSON","regional":"DOURADOS"},"AGUA CLARA":{"polo":"TRES LAGOAS","supervisor":"DIEGO","regional":"TRES LAGOAS"},"BATAGUASSU":{"polo":"TRES LAGOAS","supervisor":"DIEGO","regional":"TRES LAGOAS"},"BRASILANDIA":{"polo":"TRES LAGOAS","supervisor":"DIEGO","regional":"TRES LAGOAS"},"RIBAS DO RIO PARDO":{"polo":"TRES LAGOAS","supervisor":"DIEGO","regional":"TRES LAGOAS"},"SANTA RITA DO PARDO":{"polo":"TRES LAGOAS","supervisor":"DIEGO","regional":"TRES LAGOAS"},"TRES LAGOAS":{"polo":"TRES LAGOAS","supervisor":"DIEGO","regional":"TRES LAGOAS"}};

  // Cidades com prazo diferenciado de Reposição/Recomposição (7 dias úteis,
  // Tabela 8 do 4º Termo Aditivo ao Contrato de PPP Sanesul/MS Pantanal).
  // Demais municípios seguem 5 dias úteis (valor padrão em SLA_POR_CODIGO).
  const CIDADES_REPOSICAO_7_DIAS = ["TRES LAGOAS", "PONTA PORA", "DOURADINA", "FATIMA DO SUL"];

  function isCidadeReposicao7Dias(municipio) {
    if (!municipio) return false;
    const norm = String(municipio)
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""); // remove acentos
    return CIDADES_REPOSICAO_7_DIAS.includes(norm);
  }

  // Tabela de prazo oficial por tipo de serviço (Tabela 8 do 4º Termo
  // Aditivo ao Contrato de PPP Sanesul/MS Pantanal — fonte contratual
  // assinada, substitui fontes anteriores em caso de divergência).
  // Chave = código numérico extraído do início do campo "Serv Solicitado Os".
  const SLA_POR_CODIGO = {
    // LIGAÇÃO — 10 dias úteis
    14110: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14114: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14115: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14170: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14210: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14320: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14410: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14420: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14510: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14520: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14610: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14620: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14710: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14721: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14810: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    14820: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    15010: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    15020: { prazoValor: 10, unidade: "DIAS_UTEIS" },
    // DESOBSTRUÇÃO — 24 horas
    43000: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    43001: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    43002: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    43100: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    44291: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    60700: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    61400: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    61600: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    61800: { prazoValor: 1, unidade: "DIAS_UTEIS" },
    // REPOSIÇÃO — 5 dias úteis
    99550: { prazoValor: 5, unidade: "DIAS_UTEIS" },
    99551: { prazoValor: 5, unidade: "DIAS_UTEIS" },
    99552: { prazoValor: 5, unidade: "DIAS_UTEIS" },
    99553: { prazoValor: 5, unidade: "DIAS_UTEIS" },
    99554: { prazoValor: 5, unidade: "DIAS_UTEIS" },
    99555: { prazoValor: 5, unidade: "DIAS_UTEIS" },
    99556: { prazoValor: 5, unidade: "DIAS_UTEIS" },
    99557: { prazoValor: 5, unidade: "DIAS_UTEIS" }
  };

  // ---------------------------------------------------------------
  // Helpers de parsing
  // ---------------------------------------------------------------

  // Excel às vezes entrega datas como objeto Date, às vezes como
  // número serial (dias desde 1899-12-30). Trata os dois casos.
  function parseExcelDate(value) {
    if (!value && value !== 0) return null;
    if (value instanceof Date && !isNaN(value)) return value;
    if (typeof value === "number") {
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return isNaN(d) ? null : d;
    }
    if (typeof value === "string") {
      const d = new Date(value);
      return isNaN(d) ? null : d;
    }
    return null;
  }

  // Extrai o código numérico do início de "Serv Solicitado Os"
  // (ex: "14122-LIGAÇÃO ESGOTO/FACT/MSP/TERRA" -> 14122)
  function parseCodigoServico(texto) {
    if (!texto) return null;
    const match = String(texto).match(/^(\d+)-/);
    return match ? parseInt(match[1], 10) : null;
  }

  // "Situacao Os" real -> status usado pelo app (Aberta/Em Andamento/Concluída/Cancelada)
  // Regra: se JÁ foi baixada/executada (masc ou fem), vira "Concluída" e NÃO
  // entra mais em nenhuma contagem de atraso. Só entra como atrasada o que
  // ainda está pendente (Aberta/Em Andamento/Agendada) após o prazo.
  function mapStatus(situacaoOs) {
    if (!situacaoOs) return "Aberta";
    const s = String(situacaoOs).trim().toLowerCase();
    // "Baixada", "Baixado", "Executada", "Executado", "Executada (Pré-Baixada)", "Concluída", "Finalizada"
    if (s.includes("baixad") || s.includes("executad") || s.includes("concluíd")
        || s.includes("concluid") || s.includes("finalizad") || s.includes("realizad")) {
      return "Concluída";
    }
    if (s.includes("cancelad")) return "Cancelada";
    if (s.includes("andamento") || s.includes("coletor") || s.includes("agendad")
        || s.includes("gerad") || s.includes("emitid")) {
      return "Em Andamento";
    }
    return "Aberta";
  }

  // Procura, em todas as abas do arquivo, uma linha (dentro das 5
  // primeiras) que contenha a coluna procurada — resolve tanto planilhas
  // já tratadas (cabeçalho na linha 1) quanto exports brutos com linha de
  // título antes do cabeçalho real, em qualquer aba com qualquer nome.
  function findSheetByHeaderColumn(workbook, columnName) {
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, range: 0 });
      for (let i = 0; i < Math.min(5, rawRows.length); i++) {
        const row = rawRows[i] || [];
        if (row.some((cell) => cell != null && String(cell).trim() === columnName)) {
          return { sheetName, headerRowIndex: i };
        }
      }
    }
    return null;
  }

  // Calcula o prazo em dias úteis (exclui sábados e domingos).
  // Feriados não incluídos — o SIGIS usa apenas seg-sex, sem feriados.
  function adicionarDiasUteis(dataInicio, diasUteis) {
    let data = new Date(dataInicio.getTime());
    let adicionados = 0;
    while (adicionados < diasUteis) {
      data.setDate(data.getDate() + 1);
      const d = data.getDay();
      if (d !== 0 && d !== 6) adicionados++;
    }
    return data;
  }

  function diasUteisEntre(dataInicio, dataFim) {
    let data = new Date(dataInicio.getTime());
    const fim = new Date(dataFim.getTime());
    let dias = 0;
    while (data < fim) {
      data.setDate(data.getDate() + 1);
      const d = data.getDay();
      if (d !== 0 && d !== 6) dias++;
    }
    return dias;
  }

  // ---------------------------------------------------------------
  // Lê um arquivo como workbook XLSX (Promise, para poder processar
  // vários arquivos em sequência sem aninhar callbacks).
  // ---------------------------------------------------------------
  function readWorkbook(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          resolve(XLSX.read(data, { type: "array", cellDates: true }));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function extrairRegionalDoWorkbook(workbook) {
    const info = findSheetByHeaderColumn(workbook, "Cidade nome");
    if (!info) return null;
    return XLSX.utils.sheet_to_json(workbook.Sheets[info.sheetName], {
      defval: null,
      range: info.headerRowIndex
    });
  }

  function extrairOSDoWorkbook(workbook) {
    const info = findSheetByHeaderColumn(workbook, "Nº OS");
    if (!info) return null;
    return XLSX.utils.sheet_to_json(workbook.Sheets[info.sheetName], {
      defval: null,
      range: info.headerRowIndex
    });
  }

  function reaplicarRegionalNoBancoAtual(regionalRows) {
    const lookup = new Map();
    if (regionalRows && regionalRows.length > 0) {
      regionalRows.forEach((r) => {
        const cidade = r["Cidade nome"] != null ? String(r["Cidade nome"]).trim().toUpperCase() : null;
        if (!cidade) return;
        lookup.set(cidade, { polo: r["Polo Sanesul"] || null, supervisor: r["Supervisor"] || null, regional: r["Regional"] || null });
      });
    } else {
      Object.entries(BASE_REGIONAL_EMBUTIDA).forEach(([cidade, dados]) => lookup.set(cidade, dados));
    }
    window.COIDatabase.os.forEach((os) => {
      const found = lookup.get(String(os.municipio).trim().toUpperCase());
      if (found) {
        os.polo = found.polo;
        os.supervisor = found.supervisor;
        os.regional = found.regional;
      }
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(window.COIDatabase));
    } catch (err) {
      console.warn("Não foi possível salvar em localStorage:", err);
    }
  }

  // ---------------------------------------------------------------
  // handleFileSelection: único ponto de entrada da importação.
  // Aceita 1 ou vários arquivos de uma vez; identifica sozinho se cada
  // um é a planilha de OS ("Nº OS") ou a Base de Regionais ("Cidade
  // nome"), sem precisar de botões separados.
  // ---------------------------------------------------------------
  async function handleFileSelection(fileList) {
    const statusEl = document.getElementById("import-status");
    if (statusEl) statusEl.textContent = "Lendo arquivo(s)...";

    let osRows = null;
    let osFileName = null;
    let regionalRows = null;
    const naoReconhecidos = [];

    for (const file of Array.from(fileList)) {
      try {
        const workbook = await readWorkbook(file);
        const os = extrairOSDoWorkbook(workbook);
        const regional = extrairRegionalDoWorkbook(workbook);

        if (os) {
          osRows = os;
          osFileName = file.name;
          // Um mesmo arquivo pode trazer as duas coisas (aba Base embutida)
          if (regional) regionalRows = regional;
        } else if (regional) {
          regionalRows = regional;
        } else {
          naoReconhecidos.push(file.name);
        }
      } catch (err) {
        console.error(err);
        naoReconhecidos.push(file.name);
      }
    }

    // Salva/atualiza a Base de Regionais, se veio alguma
    if (regionalRows) {
      try {
        localStorage.setItem(BASE_STORAGE_KEY, JSON.stringify(regionalRows));
      } catch (err) {
        console.warn("Não foi possível salvar Base de Regionais:", err);
      }
      // Se já existe uma base de OS carregada e não veio um novo arquivo
      // de OS junto, só atualiza o cruzamento de Polo/Supervisor nela.
      if (!osRows && window.COIDatabase && window.COIDatabase.os && window.COIDatabase.os.length > 0) {
        reaplicarRegionalNoBancoAtual(regionalRows);
      }
    }

    // Se não veio Base neste envio, usa a que já estava salva (import anterior)
    if (!regionalRows) {
      try {
        const cached = localStorage.getItem(BASE_STORAGE_KEY);
        if (cached) regionalRows = JSON.parse(cached);
      } catch (err) {
        console.warn("Não foi possível carregar Base de Regionais salva:", err);
      }
    }

    // Processa a planilha de OS, se veio alguma
    if (osRows) {
      const db = buildDatabaseFromRows(osRows, regionalRows || []);
      window.COIDatabase = db;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      } catch (err) {
        console.warn("Não foi possível salvar em localStorage:", err);
      }
    }

    // Monta a mensagem de status final
    const partes = [];
    if (osRows) partes.push(`Arquivo: ${osFileName} | Registros: ${window.COIDatabase.os.length}`);
    if (regionalRows && regionalRows.length > 0) partes.push(`Base de Regionais: ${regionalRows.length} cidades (importada)`);
    else if (osRows) partes.push(`Base de Regionais: 70 cidades (embutida)`);
    if (!osRows && !regionalRows) partes.push("Nenhum arquivo reconhecido (esperado: coluna \"Nº OS\" ou \"Cidade nome\")");
    if (naoReconhecidos.length > 0) partes.push(`Ignorado(s): ${naoReconhecidos.join(", ")}`);

    if (statusEl) {
      statusEl.textContent = partes.join(" · ");
      statusEl.classList.remove("import-status-warning");
    }

    if (typeof window.popularFiltros === "function") window.popularFiltros();
    if (typeof window.renderAll === "function") {
      window.renderAll();
      setTimeout(() => {
        if (typeof window.popularFiltros === "function") window.popularFiltros();
        if (typeof window.renderAll === "function") window.renderAll();
      }, 300);
      // Render extra para Indicadores Contratuais (SVG/gauge)
      setTimeout(() => {
        if (typeof window.renderAll === "function") window.renderAll();
      }, 600);
    }
  }

  // ---------------------------------------------------------------
  // Converte as linhas da planilha para o formato de window.COIDatabase
  // ---------------------------------------------------------------
  function buildDatabaseFromRows(rows, regionalRows) {
    const clientesMap = new Map();
    const tecnicosMap = new Map();
    const tiposServicoMap = new Map();
    const osList = [];

    // Lookup Cidade -> {polo, coordenacao, supervisor, regional}
    // Usa a base importada se disponível; senão usa a embutida (fallback automático).
    const regionalLookup = new Map();
    const baseSource = (regionalRows && regionalRows.length > 0) ? regionalRows : null;
    if (baseSource) {
      baseSource.forEach((r) => {
        const cidade = r["Cidade nome"] != null ? String(r["Cidade nome"]).trim().toUpperCase() : null;
        if (!cidade) return;
        regionalLookup.set(cidade, {
          polo: r["Polo Sanesul"] || null,
          coordenacao: r["Coordenação"] || null,
          supervisor: r["Supervisor"] || null,
          regional: r["Regional"] || null
        });
      });
    } else {
      // Fallback: base embutida (70 cidades do MS, atualizada em jul/2026)
      Object.entries(BASE_REGIONAL_EMBUTIDA).forEach(([cidade, dados]) => {
        regionalLookup.set(cidade, dados);
      });
    }

    rows.forEach((r) => {
      const numOS = r["Nº OS"];
      if (numOS === null || numOS === undefined || numOS === "") return; // linha sem OS válida

      const matricula = r["Matricula"] != null ? String(r["Matricula"]) : "SEM_MATRICULA";
      const equipeCodigo = r["Equipe Programada"] != null ? parseInt(r["Equipe Programada"], 10) : 0;
      const servSolicitado = r["Serv Solicitado Os"] || "";
      const codigoServico = parseCodigoServico(servSolicitado);
      const municipio = r["Localidade"] || r["Polo"] || "Não informado";

      // --- Cliente (dado real disponível: apenas matrícula + localidade) ---
      if (!clientesMap.has(matricula)) {
        clientesMap.set(matricula, {
          id_cliente: matricula,
          nome: matricula, // planilha não traz nome de cliente, apenas matrícula
          municipio: municipio
        });
      }

      // --- Técnico/Equipe (dado real disponível: apenas código de equipe) ---
      if (!tecnicosMap.has(equipeCodigo)) {
        tecnicosMap.set(equipeCodigo, {
          id_tecnico: equipeCodigo,
          nome: `Equipe ${equipeCodigo}`,
          equipe: `Equipe ${equipeCodigo}`,
          ativo: true
        });
      }

      // --- Tipo de Serviço ---
      if (codigoServico !== null && !tiposServicoMap.has(codigoServico)) {
        const sla = SLA_POR_CODIGO[codigoServico];
        tiposServicoMap.set(codigoServico, {
          id_tipo_servico: codigoServico,
          nome: String(servSolicitado).replace(/^\d+-/, "").trim() || "Serviço não identificado",
          prazo_padrao: sla ? sla.prazoValor : null,
          prazo_unidade: sla ? sla.unidade : null
        });
      }

      // --- Datas ---
      const dataAbertura = parseExcelDate(r["Data Inclusão"]);
      const dataFimExec = parseExcelDate(r["Data Fim Exec Os"]);
      const dataExecProgEmp = parseExcelDate(r["Data Exec Prog Emp"]);

      // Prazo: usa a regra oficial (Seção 3) quando o código tem SLA formal;
      // senão usa o prazo já programado pela própria OS (regra já confirmada
      // no master para os tipos sem SLA formal).
      let dataPrazo = dataExecProgEmp;
      let slaFormal = codigoServico !== null ? SLA_POR_CODIGO[codigoServico] : null;
      // Exceção contratual (Tabela 8): Reposição/Recomposição em Três Lagoas,
      // Ponta Porã, Douradina e Fátima do Sul tem prazo de 7 dias úteis,
      // não 5 — sobrepõe o valor padrão da tabela para esses municípios.
      if (slaFormal && slaFormal.unidade === "DIAS_UTEIS" && slaFormal.prazoValor === 5 && isCidadeReposicao7Dias(municipio)) {
        slaFormal = { prazoValor: 7, unidade: "DIAS_UTEIS" };
      }
      if (slaFormal && dataAbertura) {
        // Todos os prazos agora em DIAS_UTEIS (alinhado com o SIGIS).
        // Desobstrução: 1 dia útil (regra vigente no SIGIS até a conversão
        // formal para 24h pela nova R.O.).
        dataPrazo = adicionarDiasUteis(dataAbertura, slaFormal.prazoValor);
      }

      const status = mapStatus(r["Situacao Os"]);
      // Campo já calculado pela planilha de origem (Seção 7.1 do master:
      // STATUS_NOVO / "Status Prazo") — usado para SLA/atraso reais,
      // em vez de recalcular por diferença de datas.
      const statusPrazoOrigem = r["Status Prazo"] ? String(r["Status Prazo"]).trim().toUpperCase() : null;

      // Polo/Supervisor: usa as colunas diretas da planilha quando existem
      // (RELATORIO_IDEAL.xlsx já vem com Polo e Supervisor preenchidos).
      // Fallback: cruzamento pela cidade via base embutida (para planilhas
      // brutas do SIGIS que não trazem essas colunas).
      const poloDirecto = r["Polo"] ? String(r["Polo"]).trim() : null;
      const supervisorDirecto = r["Supervisor"] ? String(r["Supervisor"]).trim() : null;
      const regional = regionalLookup.get(String(municipio).trim().toUpperCase());
      const polo = poloDirecto || (regional ? regional.polo : null);
      const supervisor = supervisorDirecto || (regional ? regional.supervisor : null);
      const regionalNome = regional ? regional.regional : null;

      const dataExecProgCli = parseExcelDate(r["Data Exec Prog Cli"]);
      const dataInicioExec = parseExcelDate(r["Data Inicio Exec Os"]);

      osList.push({
        id_os: numOS,
        numero_os: `OS-${numOS}`,
        id_cliente: matricula,
        id_tecnico: equipeCodigo,
        id_tipo_servico: codigoServico,
        municipio: municipio,
        polo: polo,
        supervisor: supervisor,
        regional: regionalNome,
        prioridade: "Média", // PROVISÓRIO: planilha não possui campo de prioridade
        data_abertura: dataAbertura ? dataAbertura.toISOString() : null,
        data_prazo: dataPrazo ? dataPrazo.toISOString() : null,
        data_prazo_programada: dataExecProgEmp ? dataExecProgEmp.toISOString() : null,
        data_conclusao: status === "Concluída" && dataFimExec ? dataFimExec.toISOString() : null,
        status: status,
        situacao_original: r["Situacao Os"] ? String(r["Situacao Os"]).trim() : status,
        status_prazo_origem: statusPrazoOrigem,
        // Campos extras — mesmo detalhe que a tela "Consulta Ordem de Serviço" do SIGIS
        endereco: r["Endereço"] || null,
        bairro: r["Bairro"] || null,
        ponto_ref: r["Ponto Ref."] || null,
        servico_solicitado_texto: servSolicitado || null,
        servico_executado_texto: r["Serv Executado Os"] || null,
        prazo_exec_cliente: dataExecProgCli ? dataExecProgCli.toISOString() : null,
        data_inicio_exec: dataInicioExec ? dataInicioExec.toISOString() : null,
        observacao: r["Observação"] || null
      });
    });

    return {
      clientes: Array.from(clientesMap.values()),
      tecnicos: Array.from(tecnicosMap.values()),
      tiposServico: Array.from(tiposServicoMap.values()),
      os: osList,
      historicoStatus: []
    };
  }

  // ---------------------------------------------------------------
  // Carrega dados salvos (se existirem) ANTES do app.js inicializar,
  // já que os scripts executam em ordem: database.js -> import.js -> app.js
  // ---------------------------------------------------------------
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      window.COIDatabase = JSON.parse(saved);
    }
  } catch (err) {
    console.warn("Não foi possível carregar dados salvos:", err);
  }

  // ---------------------------------------------------------------
  // Liga o botão/input de importação assim que o DOM estiver pronto
  // ---------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("import-file-input");
    const statusEl = document.getElementById("import-status");

    if (window.COIDatabase && localStorage.getItem(STORAGE_KEY) && statusEl) {
      let msg = `Registros: ${window.COIDatabase.os.length} (importação anterior)`;
      let semRegional = true;
      try {
        const cachedBase = localStorage.getItem(BASE_STORAGE_KEY);
        if (cachedBase) {
          msg += ` · Base de Regionais: ${JSON.parse(cachedBase).length} cidades`;
          semRegional = false;
        } else {
          msg += " · Polo/Supervisor: não disponível (inclua a Base de Regionais)";
        }
      } catch (err) { /* ignora */ }
      statusEl.textContent = msg;
      statusEl.classList.toggle("import-status-warning", semRegional);
    }

    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) handleFileSelection(e.target.files);
      });
    }
  });

  window.COIImport = { handleFileSelection, buildDatabaseFromRows };
})();
