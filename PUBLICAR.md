# Publicar o Kard para os amigos (instalador, atualização automática e jogo online)

Este guia cobre o que precisa ser configurado **fora do VS Code**. A configuração das contas (Supabase, e-mail e Google) está em [SUPABASE.md](SUPABASE.md) — faça aquele primeiro.

---

## 1. Supabase: liberar o jogo online (Realtime)

O jogo online usa o **Realtime** do mesmo projeto do Supabase (canais de mensagens + presença). Não há tabela nova nem servidor extra.

1. No painel do Supabase, abra **Realtime → Settings** (em alguns painéis: **Project Settings → Realtime**).
2. Confirme que **"Allow public access" está ligado** / **"Private channels only" está desligado**. O Kard usa canais públicos com um código aleatório de 6 caracteres por mesa (só quem tem o código entra).
3. Limites do plano gratuito (sobram para jogar entre amigos): 200 conexões simultâneas, 100 mensagens por segundo, 2 milhões de mensagens por mês. Cada jogada é uma mensagem pequena.

> Se um dia o projeto ficar "pausado" (7 dias sem uso no plano grátis), o login e o online param até você clicar em **Restore** no painel.

## 2. GitHub: onde ficam o instalador e as atualizações

A atualização automática baixa as versões novas das **Releases** de um repositório do GitHub.

### 2.1 Criar o repositório

1. Crie uma conta em <https://github.com> (se ainda não tiver).
2. **New repository** → nome `kard-tcg` → pode ser **Private** ou **Public**.
   - **Public** é o mais simples: os amigos baixam o instalador pelo link da Release e o app se atualiza sem nenhuma senha.
   - **Private** funciona para você publicar, mas o app dos amigos **não consegue** baixar atualizações de repositório privado sem token. Para o seu caso, use **Public** (o código fica visível; o `.env` não vai para o GitHub porque está no `.gitignore`).
3. Envie o projeto (no terminal do VS Code, na pasta do projeto):

   ```
   git add .
   git commit -m "Primeira versão"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/kard-tcg.git
   git push -u origin main
   ```

### 2.2 Apontar o app para o repositório

No arquivo [`electron-builder.yml`](electron-builder.yml), troque `SEU-USUARIO-GITHUB` pelo seu usuário do GitHub (e `repo` se o nome for diferente):

```yaml
publish:
  provider: github
  owner: seu-usuario
  repo: kard-tcg
```

### 2.3 Token para publicar

1. GitHub → foto de perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** só o `kard-tcg`. **Permissions → Repository permissions → Contents: Read and write**.
3. Gere e copie o token (começa com `github_pat_`). Ele só aparece uma vez.
4. Guarde-o como variável de ambiente do Windows (uma vez só): **Iniciar → "Editar as variáveis de ambiente para sua conta" → Novo** → nome `GH_TOKEN`, valor = o token. Feche e abra o VS Code depois.

> Nunca coloque o token em arquivos do projeto.

## 3. Publicar uma versão

1. Confira o `.env` (URL e chave **pública** do Supabase) — ele é embutido no instalador.
2. Aumente a versão em `package.json` → `"version"` (ex.: `0.1.0` → `0.2.0`). **Toda publicação precisa de um número novo**, senão os apps não percebem a atualização.
3. No terminal:

   ```
   npm run release
   ```

   Isso gera o instalador e cria um **rascunho** de Release no GitHub com os arquivos (`Kard-TCG-Simulator-Setup-x.y.z.exe`, `latest.yml` e o `.blockmap`).
4. No GitHub → **Releases** → abra o rascunho → **Publish release**. A partir daí:
   - o link da Release serve para os amigos baixarem a primeira vez;
   - quem já tem o app recebe a versão nova sozinho (baixa em segundo plano e aparece **"Versão x.y.z pronta — reiniciar"** na barra lateral).

Para gerar só o instalador local, sem publicar: `npm run dist` (fica em `release/`).

## 4. Para os amigos

1. Baixar o `.exe` na página de Releases e instalar.
2. O Windows mostra **"O Windows protegeu o computador"** (o app não tem assinatura digital paga): **Mais informações → Executar assim mesmo**.
3. No Kard: **Download de cartas → Baixar** (cada um baixa o banco no próprio computador; todos devem estar com o banco atualizado para jogarem juntos).
4. **Entrar / Cadastre-se** → criar a conta e confirmar o código do e-mail.
5. Montar um deck → **Jogar online** → entrar com o código da mesa.

## 5. Como jogar online

- **Quem cria a mesa** (anfitrião) escolhe **1 contra 1** (com o formato) ou **Commander (até 4 jogadores)** e passa o código de 6 letras.
- Cada um escolhe um deck válido para o formato e clica em **Pronto**; o anfitrião clica em **Começar partida**.
- As regras rodam no computador do anfitrião, que confirma cada jogada; se alguém cair, é só entrar de novo com o mesmo código para voltar à partida.
- Se o **anfitrião** sair, a partida para (os outros não conseguem continuar sem ele).
- Todos precisam estar com a **mesma versão do Kard** e o **banco de cartas atualizado**.

## Checklist rápido

- [ ] Supabase configurado ([SUPABASE.md](SUPABASE.md)): tabelas, `.env`, SMTP, template com código, Google.
- [ ] Realtime com acesso público liberado.
- [ ] Repositório no GitHub (público) e `owner`/`repo` no `electron-builder.yml`.
- [ ] Variável de ambiente `GH_TOKEN` criada.
- [ ] Versão aumentada no `package.json` → `npm run release` → **Publish release** no GitHub.
