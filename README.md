# Kard - TCG Simulator

Simulador de trading card games para desktop (Windows). A primeira versão suporta **Magic: The Gathering**:

- **Banco de cartas**: baixa todas as cartas do Scryfall para a pasta `database` do programa, no idioma escolhido (PT, EN, ES, FR, DE, IT, JA, KO, RU, ZH).
- **Construtor de decks**: todos os formatos principais (Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Commander, Duel Commander, Brawl, Oathbreaker, Pauper Commander, PreDH, Limitado, Casual...), com validação das regras de construção, **escolha da arte de cada carta** (todas as impressões/idiomas), curva de mana, importação e exportação no formato MTG Arena/MTGO.
- **Jogo contra bot**: partida 1x1 com o **juiz de regras** validando cada jogada.

## Rodar em desenvolvimento (VS Code)

Pré-requisito: Node.js 22 ou superior.

```bash
npm install
npm run dev
```

No VS Code:

- **Ctrl+Shift+B** roda a tarefa padrão `Kard: dev (hot reload)`.
- **F5** → `Kard: Debug (Main + Renderer)` depura o processo principal e a interface com breakpoints.
- No app, **F12** abre as ferramentas de desenvolvedor.

Em modo dev, o banco de cartas fica em `./database` (na raiz do projeto, ignorado pelo git).

## Gerar o instalador (.exe)

```bash
npm run dist
```

O instalador é gerado em `release/Kard-TCG-Simulator-Setup-<versão>.exe`. Ele instala por usuário (sem precisar de administrador), permite escolher a pasta e cria atalhos na área de trabalho e no menu Iniciar.

## Onde ficam os dados

| O quê | Onde |
| --- | --- |
| Banco de cartas e cache de imagens | `<pasta de instalação>\database` (se a pasta não permitir escrita, ex.: Program Files, usa `%APPDATA%\Kard - TCG Simulator\database`) |
| Decks | `%APPDATA%\Kard - TCG Simulator\decks` (sobrevivem a reinstalações) |
| Configurações (chave da API criptografada) | `%APPDATA%\Kard - TCG Simulator\settings.json` |

> Ao desinstalar/atualizar pelo instalador, a pasta `database` pode ser apagada junto com o programa — basta baixar o banco de novo. Os decks não são afetados.

## O juiz de regras

Toda partida passa pelo juiz. São duas camadas:

1. **Motor de regras local** (`src/shared/engine`, sempre ativo, offline): toda ação é validada antes de ser aplicada (`performAction`). Cobre a estrutura de turno (desvirar, manutenção, compra, fases principais, combate em 5 etapas, final, limpeza), prioridade e pilha, mulligan de Londres, terreno por turno, velocidade de feitiço/instantâneo, pagamento automático de mana (híbrida, phyrexiana, X, imposto de comandante), alvos e proteção (resistência a magia/manto), combate completo (voar/alcance, ameaça, iniciativa/golpe duplo, atropelar, toque mortífero, vínculo com a vida, vigilância, defensor, enjoo de invocação), ações baseadas em estado (vida 0, grimório vazio, 10 venenos, 21 de dano de comandante, resistência 0/dano letal, lealdade 0, regra das lendas, auras/equipamentos), zona de comando, e um interpretador do texto oracle das cartas (dano, compra, destruir, exilar, devolver, fichas, marcadores, bônus, anular, vidência, busca de terreno, descarte, lutar, ganhar controle, gatilhos de entrar/morrer/atacar/manutenção/landfall, habilidades ativadas, lealdade, auras, equipamentos, anthems, terrenos condicionais...). Jogadas inválidas mostram o erro do juiz (ex.: "Você já jogou um terreno neste turno").
2. **Juiz IA (Claude, opcional)**: com uma chave da API da Anthropic em Configurações, o Claude interpreta os textos de cartas que o motor não reconhece e devolve operações estruturadas que o motor aplica; também responde dúvidas de regras pelo chat da partida. Modelo padrão: Claude Opus 5.5 (Sonnet 5.5 e Haiku 5.5 disponíveis). As requisições usam o fallback automático do servidor caso o modelo recuse um pedido.

Sem o Juiz IA, partes de efeitos não automatizadas são registradas no log e podem ser aplicadas com **ajustes manuais** (botão direito em cartas, vida e zonas) — que também ficam registrados.

Ferramentas de teste do motor:

```bash
npm run test:engine                                                       # bot x bot com cartas sintéticas
node --experimental-strip-types scripts/engine-stress.ts 25               # bot x bot com decks aleatórios de cartas reais (requer o banco baixado)
node --experimental-strip-types scripts/engine-mechanics.ts 20            # bot x bot com decks focados em mecanismos (tutores, modos, custos adicionais...)
node --experimental-strip-types scripts/parser-coverage.ts --examples     # % de cartas totalmente automatizadas + textos que faltam
```

## Estrutura

```
src/main        Processo principal do Electron (download do Scryfall, banco em memória, imagens, decks, Juiz IA)
src/preload     Ponte segura entre interface e processo principal (window.kard)
src/renderer    Interface React (páginas, construtor de decks, mesa de jogo)
src/shared      Tipos, formatos/validação de decks e o motor de regras (TypeScript puro)
scripts         Testes e métricas do motor
build           Ícone do instalador
resources       Ícone da janela
```

## Créditos

Dados e imagens de cartas: [Scryfall](https://scryfall.com). Magic: The Gathering é marca da Wizards of the Coast. Projeto não oficial, não afiliado à Wizards of the Coast, distribuído sob a Política de Conteúdo de Fãs da Wizards.
