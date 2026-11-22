(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const STORAGE_KEY = "kiscan.locale";
  const LOCALES = {
    es: {
      productTag: "Evaluador de operaciones cripto",
      skip: "Saltar al contenido", connection: "Conexión con la red", settings: "Conexión con la red",
      foot: "4kiscan usa datos públicos de la red y lo que tú declaras. No ve los sistemas internos de exchanges ni de puentes, y no es asesoría legal ni financiera.",
      settingsTitle: "Conexión con la red", settingsIntro: "Para comprobar qué pasó realmente con una transacción, 4kiscan consulta la red a través de <strong>Alchemy</strong>. Necesitas una clave gratuita (API key) de <a href=\"https://www.alchemy.com/\" target=\"_blank\" rel=\"noopener noreferrer\">alchemy.com</a> con las redes Ethereum, Polygon, Optimism, Arbitrum y Base habilitadas.",
      apiKey: "Clave de Alchemy", remember: "Recordarla en este navegador", test: "Probar clave", clear: "Quitar clave", save: "Guardar",
      keyPlaceholder: "Pega tu clave aquí", keyNote: "La clave solo se envía a Alchemy, desde tu navegador. No pasa por ningún otro servidor. Si no marcas la casilla, se olvida al cerrar esta pestaña.",
      noKeyNote: "Sin clave también puedes usar el evaluador: la conclusión se basará solo en lo que declares y lo indicará.",
      language: "Idioma",
      start: "Empezar", continue: "Continuar", unknownAnswer: "No sé / prefiero omitir",
      change: "Cambiar", restart: "Empezar de nuevo", back: "Volver", evaluate: "Evaluar la operación",
      copy: "Copiar informe", review: "Revisar respuestas", addKey: "Agregar clave de Alchemy",
      networkConnected: "Red conectada", noKey: "Sin clave de Alchemy", transcript: "Lo que llevamos",
      ready: "Listo para evaluar", readyText: "Revisa lo que nos contaste en «Lo que llevamos»; puedes cambiar cualquier respuesta.",
      question: "Pregunta", of: "de", answer: "Tu respuesta", answerHelp: "Aclarar conceptos de esta pregunta",
      resultCopy: "Informe copiado", resultCopyFail: "No se pudo copiar; selecciona el texto manualmente",
      reportTitle: "EVALUACIÓN DE OPERACIÓN CRIPTO",
    },
    en: {
      productTag: "Crypto transaction evaluator",
      skip: "Skip to content", connection: "Network connection", settings: "Network connection",
      foot: "4kiscan uses public network data and what you declare. It cannot access exchange or bridge internal systems and is not legal or financial advice.",
      settingsTitle: "Network connection", settingsIntro: "To check what really happened to a transaction, 4kiscan queries the network through <strong>Alchemy</strong>. You need a free <a href=\"https://www.alchemy.com/\" target=\"_blank\" rel=\"noopener noreferrer\">Alchemy API key</a> with Ethereum, Polygon, Optimism, Arbitrum and Base enabled.",
      apiKey: "Alchemy API key", remember: "Remember it in this browser", test: "Test key", clear: "Remove key", save: "Save",
      keyPlaceholder: "Paste your key here", keyNote: "The key is sent only to Alchemy from your browser. It does not pass through any other server. If unchecked, it will be forgotten when this tab closes.",
      noKeyNote: "You can also use the evaluator without a key: the conclusion will rely only on what you declare.",
      language: "Language",
      start: "Start", continue: "Continue", unknownAnswer: "I don't know / skip",
      change: "Change", restart: "Start over", back: "Back", evaluate: "Evaluate transaction",
      copy: "Copy report", review: "Review answers", addKey: "Add Alchemy key",
      networkConnected: "Network connected", noKey: "No Alchemy key", transcript: "What we've collected",
      ready: "Ready to evaluate", readyText: "Review what you told us in “What we've collected”; you can change any answer.",
      question: "Question", of: "of", answer: "Your answer", answerHelp: "Explain concepts in this question",
      resultCopy: "Report copied", resultCopyFail: "Could not copy; select the text manually",
      reportTitle: "CRYPTO TRANSACTION EVALUATION",
    },
    pt: {
      productTag: "Avaliador de operações cripto",
      skip: "Ir para o conteúdo", connection: "Conexão de rede", settings: "Conexão de rede",
      foot: "O 4kiscan usa dados públicos da rede e o que você declara. Não acessa sistemas internos de exchanges ou pontes e não constitui aconselhamento jurídico ou financeiro.",
      settingsTitle: "Conexão de rede", settingsIntro: "Para verificar o que realmente aconteceu com uma transação, o 4kiscan consulta a rede por meio da <strong>Alchemy</strong>. Você precisa de uma chave gratuita da <a href=\"https://www.alchemy.com/\" target=\"_blank\" rel=\"noopener noreferrer\">alchemy.com</a>, com Ethereum, Polygon, Optimism, Arbitrum e Base habilitados.",
      apiKey: "Chave da Alchemy", remember: "Lembrar neste navegador", test: "Testar chave", clear: "Remover chave", save: "Salvar",
      keyPlaceholder: "Cole sua chave aqui", keyNote: "A chave é enviada apenas à Alchemy, a partir do seu navegador. Ela não passa por nenhum outro servidor. Se não estiver marcada, será esquecida ao fechar esta aba.",
      noKeyNote: "Você também pode usar o avaliador sem chave: a conclusão será baseada apenas no que você declarar.",
      language: "Idioma",
      start: "Começar", continue: "Continuar", unknownAnswer: "Não sei / prefiro omitir",
      change: "Alterar", restart: "Começar novamente", back: "Voltar", evaluate: "Avaliar a operação",
      copy: "Copiar relatório", review: "Revisar respostas", addKey: "Adicionar chave da Alchemy",
      networkConnected: "Rede conectada", noKey: "Sem chave da Alchemy", transcript: "O que coletamos",
      ready: "Pronto para avaliar", readyText: "Revise o que você informou em «O que coletamos»; você pode alterar qualquer resposta.",
      question: "Pergunta", of: "de", answer: "Sua resposta", answerHelp: "Explicar conceitos desta pergunta",
      resultCopy: "Relatório copiado", resultCopyFail: "Não foi possível copiar; selecione o texto manualmente",
      reportTitle: "AVALIAÇÃO DE OPERAÇÃO CRIPTO",
    },
  };

  function normalize(value) {
    const key = String(value || "").toLowerCase().slice(0, 2);
    return LOCALES[key] ? key : "en";
  }
  function getLocale() {
    try { return normalize(localStorage.getItem(STORAGE_KEY) || "en"); } catch (_) { return "en"; }
  }
  function setLocale(locale) {
    const next = normalize(locale);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
    document.documentElement.lang = next;
  }
  function t(key) {
    const locale = getLocale();
    return LOCALES[locale][key] || LOCALES.en[key] || LOCALES.es[key] || key;
  }
  setLocale(getLocale());
  Object.assign(K, { LOCALES, STORAGE_KEY, getLocale, setLocale, t });
})();
