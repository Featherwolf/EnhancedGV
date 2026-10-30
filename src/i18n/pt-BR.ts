import type { TranslationKey } from "./en";

/**
 * Português (Brasil) — tradução da interface do plugin.
 */
export const ptBR: Record<TranslationKey, string> = {
  // Store panel chrome
  "store.title": "Loja",
  "store.unmatched":
    "Este jogo ainda não foi associado a uma página da loja Steam. Defina o Steam App ID em Acesso Rápido → EnhancedGV → Fonte de dados da loja para carregar o conteúdo.",
  "store.unavailable": "Conteúdo da loja indisponível ({reason})",
  "store.noStoreData": "sem dados da loja",
  "store.whatsThisAbout": "Sobre o que é este jogo?",
  "store.via": "via {provider}",

  // Collapsible section titles
  "section.about": "Sobre este jogo",
  "section.features": "Recursos e detalhes",
  "section.deck": "Steam Deck",
  "section.reviews": "Avaliações",
  "section.news": "Histórico de atualizações",

  // Data-source provider labels
  "provider.steam": "Steam",
  "provider.igdb": "IGDB",
  "provider.hasheous": "Hasheous",

  // About / description
  "description.none": "Nenhuma descrição disponível.",

  // Features & details
  "features.developer": "Desenvolvedora",
  "features.publisher": "Distribuidora",
  "features.released": "Lançamento",
  "features.comingSoon": "{date} (Em breve)",
  "features.platforms": "Plataformas",
  "features.controller": "Controle",
  "features.controllerFull": "Suporte completo",
  "features.controllerPartial": "Suporte parcial",
  "features.achievements": "Conquistas",
  "features.metacritic": "Metacritic",
  "features.price": "Preço",
  "features.languages": "Idiomas",

  // Tradução de melhor esforço para os badges de gênero/tema. Os gêneros e
  // categorias da própria Steam já chegam localizados (via o parâmetro l= de
  // get_appdetails), então essas chaves nunca batem com eles -- continuam
  // aparecendo sem alteração do mesmo jeito. Elas existem para jogos
  // não-Steam (Hasheous), cujas tags são geradas por IA e não têm nenhuma
  // API de tradução para chamar -- um vocabulário aberto e crescente a cada
  // jogo, então isto cobre só as palavras de gênero/tema mais comuns e
  // reutilizáveis; o que não estiver aqui aparece com o texto original em
  // inglês (ver tagLabel em FeaturesSection.tsx).
  "tag.platform": "Plataforma",
  "tag.platformer": "Plataforma",
  "tag.action": "Ação",
  "tag.adventure": "Aventura",
  "tag.action_adventure": "Ação e Aventura",
  "tag.puzzle": "Quebra-cabeça",
  "tag.shooter": "Tiro",
  "tag.racing": "Corrida",
  "tag.rpg": "RPG",
  "tag.strategy": "Estratégia",
  "tag.simulation": "Simulação",
  "tag.sports": "Esportes",
  "tag.horror": "Terror",
  "tag.stealth": "Furtividade",
  "tag.survival": "Sobrevivência",
  "tag.fighting": "Luta",
  "tag.arcade": "Arcade",
  "tag.indie": "Indie",
  "tag.retro": "Retrô",
  "tag.multiplayer": "Multijogador",
  "tag.singleplayer": "Um jogador",
  "tag.single_player": "Um jogador",
  "tag.card": "Cartas",
  "tag.party": "Festa",
  "tag.music": "Música",
  "tag.rhythm": "Ritmo",
  "tag.educational": "Educativo",
  "tag.trivia": "Perguntas e respostas",
  "tag.roguelike": "Roguelike",
  "tag.sandbox": "Sandbox",
  "tag.exploration": "Exploração",
  "tag.combat": "Combate",
  "tag.competitive": "Competitivo",
  "tag.turn_based": "Por turnos",
  "tag.top_down": "Visão de cima",
  "tag.side_view": "Visão lateral",
  "tag.collect": "Coleta",
  "tag.construction": "Construção",

  // Steam Deck compatibility
  "deck.none": "Sem relatório de compatibilidade com o Steam Deck.",
  "deck.label": "Deck: {label}",
  "deck.cat.0": "Desconhecido",
  "deck.cat.1": "Não suportado",
  "deck.cat.2": "Jogável",
  "deck.cat.3": "Verificado",
  "deck.note.DefaultControllerConfigFullySupported":
    "A configuração padrão do controle tem suporte completo",
  "deck.note.DefaultControllerConfigFullyFunctional":
    "A configuração padrão do controle tem suporte completo",
  "deck.note.ControllerGlyphsMatchDeckDevice":
    "Os ícones do controle no jogo correspondem ao Deck",
  "deck.note.DefaultConfigurationIsPerformant":
    "A configuração gráfica padrão tem bom desempenho",
  "deck.note.TextIsLegible": "O texto do jogo é legível",
  "deck.note.InterfaceTextIsLegible": "O texto do jogo é legível",
  "deck.note.ResolutionSupported": "A resolução nativa da tela é suportada",
  "deck.note.DisplayOutputHasBlackBars":
    "A tela apresenta faixas pretas (proporção não nativa)",
  "deck.note.TextInputDoesNotAutomaticallyInvokesKeyboard":
    "O teclado virtual não é aberto automaticamente para entrada de texto",
  "deck.note.LauncherInteractionIssues":
    "O launcher/configuração exige interação extra",
  "deck.note.ExternalControllersNotSupportedInLauncher":
    "Parte da interface não é acessível só com os controles embutidos",
  "deck.note.GamepadNavigationInGameStore":
    "Este jogo mostra o teclado virtual quando necessário",

  // Update history (news)
  "news.none": "Nenhuma atualização recente.",
  "news.viewOnline": "Ver online",

  // Reviews
  "reviews.none": "Nenhuma avaliação disponível.",
  "reviews.all": "Todas as avaliações:",
  "reviews.recent": "Avaliações recentes:",
  "reviews.langReviews": "Avaliações em {lang}:",
  "reviews.noScore": "Sem pontuação",
  // Faixa do score de 30 dias (recent.desc) -- calculada localmente a partir
  // do histograma, sem resposta da Steam para pedir em outro idioma (diferente
  // de summary.desc/lang_summary.desc, que já chegam no idioma certo via o
  // próprio parâmetro l= de get_reviews). "Muito positivas"/"Extremamente
  // positivas"/"Bem positivas"/"Mistas" confirmadas ao vivo na API da Steam
  // (appreviews?l=brazilian); "Bem negativas"/"Muito negativas" seguem o
  // mesmo padrão do lado positivo (não encontrei um jogo com essas faixas
  // para confirmar ao vivo).
  "reviews.bucket.overwhelmingly_positive": "Extremamente positivas",
  "reviews.bucket.very_positive": "Muito positivas",
  "reviews.bucket.mostly_positive": "Bem positivas",
  "reviews.bucket.mixed": "Mistas",
  "reviews.bucket.mostly_negative": "Bem negativas",
  "reviews.bucket.very_negative": "Muito negativas",
  // Nome de exibição para um código de idioma da API da loja Steam (reviews.lang
  // / a linha "Avaliações em {lang}:") -- o código em si ("brazilian",
  // "schinese", …) é uma sigla interna da API, não serve para mostrar direto.
  // Corresponde exatamente ao STORE_LANGS de lang.ts.
  "lang.english": "Inglês",
  "lang.german": "Alemão",
  "lang.french": "Francês",
  "lang.italian": "Italiano",
  "lang.koreana": "Coreano",
  "lang.latam": "Espanhol (América Latina)",
  "lang.spanish": "Espanhol",
  "lang.schinese": "Chinês (Simplificado)",
  "lang.tchinese": "Chinês (Tradicional)",
  "lang.russian": "Russo",
  "lang.thai": "Tailandês",
  "lang.japanese": "Japonês",
  "lang.brazilian": "Português (Brasil)",
  "lang.portuguese": "Português",
  "lang.polish": "Polonês",
  "lang.danish": "Dinamarquês",
  "lang.dutch": "Holandês",
  "lang.finnish": "Finlandês",
  "lang.norwegian": "Norueguês",
  "lang.swedish": "Sueco",
  "lang.hungarian": "Húngaro",
  "lang.czech": "Tcheco",
  "lang.romanian": "Romeno",
  "lang.turkish": "Turco",
  "lang.arabic": "Árabe",
  "lang.bulgarian": "Búlgaro",
  "lang.greek": "Grego",
  "lang.ukrainian": "Ucraniano",
  "lang.vietnamese": "Vietnamita",
  "lang.indonesian": "Indonésio",
  "reviews.summaryLine": "{pct}% positivas · {pos} positivas / {neg} negativas",
  "reviews.chipAll": "Todas",
  "reviews.chipPositive": "Positivas",
  "reviews.chipNegative": "Negativas",
  "reviews.loading": "Carregando avaliações…",
  "reviews.emptyFilter": "Nenhuma avaliação para este filtro.",
  "reviews.recommended": "Recomendado",
  "reviews.notRecommended": "Não recomendado",
  "reviews.hoursPlayed": "{hours}h jogadas",
  "reviews.onDeck": "🎮 no Deck",
  "reviews.earlyAccess": "Acesso antecipado",
  "reviews.readFullHint": "▸ Pressione A para ler a avaliação completa",
  "reviews.readFullAction": "Ler avaliação completa",
  "reviews.noText": "Esta avaliação não tem texto escrito.",

  // Media gallery (button glyphs A/B/X and arrows stay literal — only the
  // action word is localized)
  "media.none": "Nenhuma mídia disponível.",
  "media.browse": "Navegar",
  "media.playPause": "Reproduzir/Pausar",
  "media.mute": "Mudo",
  "media.unmute": "Com som",
  "media.exit": "Sair",
  "media.fullscreen": "Tela cheia",
  "media.exitFullscreen": "Sair da tela cheia",
  "media.play": "Reproduzir",
  "media.pause": "Pausar",

  // Patch notes modal
  "patchNotes.title": "EnhancedGV {version} — notas da versão",
  "patchNotes.loading": "Carregando…",
  "patchNotes.loadError": "Não foi possível carregar as notas da versão.",
  "patchNotes.none": "Nenhuma nota registrada para esta versão.",

  // Quick Access Settings — store data source
  "settings.openStoreView": "Abrir visualização da loja (navegável por controle)",
  "settings.storeDataSource": "Fonte de dados da loja",
  "settings.game": "Jogo",
  "settings.sourceIdLabel": "ID ou URL de origem",
  "settings.sourceIdDesc":
    "Um app ID da Steam ou URL da loja, ou igdb:12345 / hasheous:12345 para apontar para um item fora da Steam. Útil quando um jogo retrô foi associado à plataforma errada, ou um jogo de console moderno não encontrou nada.",
  "settings.matched": "Associado",
  "settings.notIdentified": "não identificado",
  "settings.saveId": "Salvar ID",
  "settings.clearBlank": "Limpar (deixar em branco)",
  "settings.redetect": "Detectar novamente automaticamente",
  "settings.lookingUp": "Buscando…",
  "settings.lookupFailed": "Falha na busca",
  "settings.setTo": "Definido como {name} ({year})",
  "settings.setToVia": "Definido como {name} ({year}) · via {provider}",
  "settings.clearedBlank":
    "Limpo — deixado em branco. Informe um ID acima para associá-lo, ou use Detectar novamente.",
  "settings.redetecting": "Detectando novamente…",

  // Quick Access Settings — non-Steam / IGDB
  "settings.nonSteamTitle": "Jogos fora da Steam (experimental)",
  "settings.nonSteamToggle": "Metadados para jogos emulados / fora da Steam",
  "settings.nonSteamDesc":
    "Quando um jogo fora da Steam não tem página na loja Steam, busca descrição, arte e detalhes no Hasheous (um banco de dados comunitário gratuito e sem chave). Desativado por padrão. Funciona melhor com jogos adicionados como atalho Steam próprio (por exemplo, via Steam ROM Manager).",
  "settings.igdbClientId": "IGDB Client ID (opcional)",
  "settings.igdbClientIdDescSaved":
    "As credenciais do IGDB estão salvas. Jogos retrô recebem capas, capturas de tela, gêneros e desenvolvedoras, em vez de apenas um logo e descrição. Elas permanecem salvas entre atualizações e reinstalações do plugin, e desinstalar o plugin não as remove — use Remover credenciais antes, se quiser retirá-las do dispositivo.",
  "settings.igdbClientIdDescUnsaved":
    "Sem isso, você tem a base sem chave: logo + descrição. Gratuito: crie uma conta Twitch, ative a verificação em duas etapas e registre um aplicativo em dev.twitch.tv/console com o tipo de cliente definido como Confidential. O passo a passo completo está no README do plugin.",
  "settings.igdbClientSecret": "IGDB Client Secret",
  "settings.igdbClientSecretDesc":
    "Gerado com [New Secret] na mesma página do aplicativo Twitch. Armazenado neste dispositivo e enviado apenas a id.twitch.tv para gerar um token de acesso.",
  "settings.saveCredentials": "Salvar credenciais",
  "settings.removeCredentials": "Remover credenciais",
  "settings.testArtwork": "Testar busca de arte",
  "settings.testing": "Testando…",
  "settings.credentialsSaved": "Credenciais salvas.",
  "settings.couldNotSave": "Não foi possível salvar: {error}",
  "settings.credentialsErased":
    "Credenciais removidas — o ID, o secret e o token de acesso em cache foram apagados deste dispositivo. Gere um novo secret em dev.twitch.tv para revogá-lo em todos os lugares.",
  "settings.couldNotClear": "Não foi possível limpar: {error}",
  "settings.result": "Resultado",

  // Quick Access Settings — sections shown / expanded
  "settings.sectionsShown": "Seções exibidas na página do jogo",
  "settings.expandedByDefault": "Expandidas por padrão",
  "settings.sectionMedia": "Mídia (vídeos e capturas de tela)",
  "settings.sectionAbout": "Sobre / descrição",
  "settings.sectionFeaturesDetails": "Recursos e detalhes",
  "settings.sectionDeckCompat": "Compatibilidade com o Steam Deck",
  "settings.sectionReviews": "Avaliações",
  "settings.sectionUpdateHistory": "Histórico de atualizações",

  // Quick Access Settings — cache
  "settings.cache": "Cache",
  "settings.clearCache": "Limpar dados da loja em cache",
  "settings.cacheClearedToast": "{count} arquivo(s) em cache removido(s)",
  "settings.cacheClearFailedToast": "Falha ao limpar o cache",

  // Quick Access Settings — updates
  "settings.updates": "Atualizações",
  "settings.installedVersion": "Versão instalada",
  "settings.latestBeta": "Última (canal beta)",
  "settings.latestRelease": "Última versão estável",
  "settings.updateAvailableSuffix": " — atualização disponível!",
  "settings.upToDateSuffix": " — atualizado",
  "settings.updateCheckLabel": "Verificação de atualização",
  "settings.updateCheckFailed": "falhou",
  "settings.viewPatchNotes": "Ver notas da versão (esta versão)",
  "settings.checkForUpdates": "Verificar atualizações",
  "settings.betaChannel": "Canal beta (versões de teste)",
  "settings.betaChannelDesc":
    "Inclui versões de teste pré-lançamento na verificação de atualizações. Desativado por padrão. Um beta carrega o número de versão que ele se tornará, e você receberá a versão final quando ela for lançada.",
  "settings.updateAvailable": "Atualização disponível: v{version}",
  "settings.downloadInstructions":
    "Baixe <b>EnhancedGV.zip</b> do lançamento no GitHub, depois no Decky escolha <b>Developer → Install Plugin from ZIP</b> e reinicie a Steam.",
  "settings.openReleasePage": "Abrir a página de lançamento",

  // Quick Access Settings — language
  "settings.language": "Idioma",
  "settings.languageAuto": "Automático (Sistema)",
  "settings.languageEnglish": "English",
  "settings.languagePortuguese": "Português (Brasil)",

  // Quick Access Settings — status / diagnostics
  "settings.statusTitle": "Status",
  "settings.statusBackend": "Backend",
  "settings.statusIntegration": "Integração",
  "settings.statusNavBridge": "Ponte de navegação",
  "settings.statusVideo": "Vídeo",
  "settings.statusCodecs": "Codecs",
  "settings.statusStoreLanguage": "Idioma da loja",
  "settings.statusFetch": "Busca de dados",
  "settings.statusDataOk": "Dados (detalhes/avaliações/notícias/deck)",
  "settings.statusDataError": "Erro de dados",
  "settings.testTrailerConnectivity": "Testar conectividade do trailer (jogo atual)",
  "settings.advancedDiagnostics": "Diagnósticos avançados",
  "settings.diagSanitizer": "Sanitizador",
  "settings.diagLayoutClass": "Classe de layout",
  "settings.diagRenderFunc": "renderFunc",
  "settings.diagAppid": "appid",
  "settings.diagNote": "Nota",
  "settings.diagPanelRenders": "Renderizações do painel",
  "settings.diagPanelState": "Estado do painel",
  "settings.diagRouteAttachMiss": "Rota / anexação / falha",
  "settings.diagMounts": "Montagens (entrada/saída)",
  "settings.diagAges": "Idades",
  "settings.diagNavBridgeFull": "Ponte de navegação (completa)",
  "settings.diagLastMiss": "Última falha",
  "settings.diagPanelBox": "Caixa do painel (l×a @topo)",
  "settings.diagMissing": "AUSENTE",

  "settings.backendChecking": "verificando…",
  "settings.backendOk": "ok",
  "settings.backendError": "erro: {error}",
  "settings.backendNotResponding": "NÃO RESPONDE — reinicie a Steam",
  "settings.videoTestNoGame": "abra a página de um jogo primeiro",
  "settings.videoTestTesting": "testando…",
  "settings.videoTestFailed": "falhou: {error}",

  // Short yes/no/unknown, used by the diagnostics readout
  "common.yes": "sim",
  "common.no": "NÃO",
};
