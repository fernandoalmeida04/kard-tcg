# Configurar as contas do Kard no Supabase

O Kard usa o Supabase só para as **contas** (nome de usuário, e-mail e senha). Decks e cartas continuam no computador de cada pessoa. Tudo abaixo cabe no **plano gratuito**.

Tempo estimado: 20–30 minutos (a maior parte é o e-mail e o Google).

---

## 1. Criar o projeto

1. Crie uma conta em <https://supabase.com> e clique em **New project**.
2. Escolha um nome (ex.: `kard`), uma senha para o banco (guarde-a) e a região **South America (São Paulo)**.
3. Espere o projeto ficar pronto (1–2 minutos).

> No plano gratuito, projetos sem uso por 7 dias são pausados. É só entrar no painel e clicar em **Restore** quando isso acontecer.

## 2. Criar as tabelas

1. No menu da esquerda, abra **SQL Editor** → **New query**.
2. Cole todo o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Deve aparecer "Success". Isso cria a tabela `profiles` (nome de usuário de cada conta), as regras de segurança e a verificação de nome disponível.

## 3. Ligar o app ao projeto

1. No painel, abra **Project Settings → API** (ou **Connect**).
2. Copie a **Project URL** e a chave **anon / publishable**.
   - Use **somente** a chave `anon`/`publishable`. **Nunca** coloque a chave `service_role`/`secret` no app.
3. Na pasta do projeto, copie `.env.example` para `.env` e preencha:

   ```
   MAIN_VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   MAIN_VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

4. Feche e abra o app de novo (`npm run dev`). O botão **Entrar / Cadastre-se** aparece no rodapé do menu.

O `.env` já está no `.gitignore`. Para o instalador (`npm run dist`), os valores do `.env` são embutidos no app no momento do build.

## 4. Cadastro com código de confirmação por e-mail

### 4.1 Confirmação de e-mail

1. **Authentication → Sign In / Providers → Email**.
2. Deixe **Enable Email provider** e **Confirm email** ligados.
3. Em **Email OTP Length**, deixe **6** (o app aceita de 6 a 10 dígitos).
4. Em **Password requirements**, escolha "Lowercase, uppercase letters, digits and symbols" e **Minimum password length = 8** (o app já exige isso, mas o servidor também passa a exigir).

### 4.2 Servidor de e-mail (SMTP) — necessário antes de editar o modelo

O Supabase só deixa **editar os modelos de e-mail** depois de configurar um SMTP próprio. Além disso, o e-mail embutido **só envia para os membros da sua equipe no Supabase**, então ele não serve para outras pessoas se cadastrarem.

Em **Authentication → Emails → SMTP Settings → Enable custom SMTP**, preencha conforme o serviço escolhido:

**Gmail (mais rápido para começar, ~500 e-mails/dia)**
1. Ative a Verificação em duas etapas em <https://myaccount.google.com/security>.
2. Crie uma senha de app em <https://myaccount.google.com/apppasswords> (nome: `Kard Supabase`) e copie os 16 caracteres.
3. Preencha: Sender email = `seuemail@gmail.com` · Sender name = `Kard` · Host = `smtp.gmail.com` · Port = `465` · Username = `seuemail@gmail.com` · Password = a senha de app (sem espaços).

**Brevo (gratuito, 300 e-mails/dia, melhor para usuários reais)**
1. Crie a conta em <https://www.brevo.com> e confirme um remetente em **Senders, Domains & Dedicated IPs → Senders**.
2. Em **SMTP & API → SMTP**, gere uma **SMTP key** e anote o **Login** (ex.: `8a1b2c001@smtp-brevo.com`).
3. Preencha: Sender email = o remetente confirmado · Sender name = `Kard` · Host = `smtp-relay.brevo.com` · Port = `587` · Username = o Login do Brevo · Password = a SMTP key.

**Resend** (3.000 e-mails/mês) também funciona, mas exige um domínio próprio verificado (Host `smtp.resend.com`, porta `465`, usuário `resend`, senha = API key).

> Com remetente Gmail/Hotmail enviado por outro serviço, parte dos e-mails pode cair no spam; com domínio próprio (ex.: `noreply@kard.app`) a entrega é melhor.

Salve. O limite passa a 30 e-mails/hora; ajuste em **Authentication → Rate Limits** se precisar.

### 4.3 Modelo do e-mail com o código

Com o SMTP configurado, o modelo fica editável. Por padrão o Supabase manda um **link**; o Kard usa um **código**. Em **Authentication → Emails → Templates → Confirm signup**:

- **Subject:** `Seu código do Kard: {{ .Token }}`
- **Body (HTML):**

  ```html
  <h2>Bem-vindo ao Kard!</h2>
  <p>Seu código de confirmação é:</p>
  <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px">{{ .Token }}</p>
  <p>Digite este código no app para ativar sua conta. Ele expira em 1 hora.</p>
  <p style="color: #888">Se você não criou uma conta no Kard, ignore este e-mail.</p>
  ```

O importante é ter `{{ .Token }}` (o código) no texto.

## 5. Login com Google

### 5.1 No Google Cloud

1. Acesse <https://console.cloud.google.com> e crie um projeto (ex.: `Kard`).
2. **APIs e serviços → Tela de consentimento OAuth**: tipo **Externo**, preencha nome do app (Kard), e-mail de suporte e e-mail do desenvolvedor. Escopos: `email`, `profile`, `openid`. Enquanto estiver em "Testes", adicione os e-mails que podem entrar em **Usuários de teste** (ou publique o app).
3. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**.
   - **URIs de redirecionamento autorizados:** `https://SEU-PROJETO.supabase.co/auth/v1/callback`
     (o endereço exato aparece no Supabase, na tela do provedor Google, como "Callback URL").
4. Copie o **ID do cliente** e a **Chave secreta do cliente**.

### 5.2 No Supabase

1. **Authentication → Sign In / Providers → Google**: ligue, cole o **Client ID** e o **Client Secret**, salve.
2. **Authentication → URL Configuration → Redirect URLs → Add URL** e adicione exatamente:

   ```
   http://127.0.0.1:53682/auth/callback
   ```

   É o endereço local onde o Kard recebe a resposta do Google (o navegador abre, você entra, e a aba avisa "Login concluído").

Contas criadas pelo Google começam sem nome de usuário; o app pede para escolher um logo depois do primeiro login.

## 6. Testar

1. `npm run dev` → **Entrar / Cadastre-se** → **Cadastre-se**.
2. Preencha nome de usuário, e-mail, senha forte e repita a senha → **Criar conta**.
3. Abra o e-mail, digite o código no app → a conta é ativada e você entra.
4. Confira em **Authentication → Users** (a conta) e **Table Editor → profiles** (o nome de usuário).
5. Saia pelo menu da conta e entre de novo com e-mail/senha; teste **Entrar com Google**.

## 6.1 Meu Perfil (foto e informações)

Clicando no nome da conta → **👤 Meu Perfil**, cada pessoa escolhe uma foto e preenche nome de exibição, localização e uma bio. Ao escolher o **TCG favorito** (Magic, Pokémon ou Yu-Gi-Oh!) aparecem campos daquele jogo (ex.: cores e carta favorita no Magic; Pokémon e tipo favorito no Pokémon; monstro, arquétipo e atributo no Yu-Gi-Oh!; formato favorito e "jogando desde" nos três). Os campos de cada jogo ficam guardados separadamente em `tcg_info` (trocar o favorito não apaga os outros); a lista de campos fica em `src/shared/profileFields.ts`.

- Rode o `supabase/schema.sql` **atualizado**: ele adiciona as colunas do perfil em `profiles` e cria o bucket público **avatars** no Storage, onde cada pessoa só envia/apaga arquivos na própria pasta.
- O app recorta a foto no centro e reduz para 256×256 (JPEG) antes de enviar, e apaga a foto antiga ao trocar.
- O perfil (foto, nomes, bio, TCG favorito) é visível para **quem está logado**: aparece no lobby e na mesa online, e clicando na foto abre o cartão de perfil. O e-mail não fica em `profiles`, então não é exposto. Só a própria pessoa altera o próprio perfil.

## 6.2 Amigos e convites para partidas

Menu **👥 Amigos** na barra lateral (mostra quantos amigos estão online e os pedidos pendentes): procurar jogadores pelo nome, enviar/aceitar/recusar pedidos, ver o perfil e desfazer amizades. No lobby de uma mesa aparece **Convidar amigos**: o amigo recebe um aviso na hora, em qualquer tela do app, com o botão **Entrar na mesa** (sem digitar o código).

- Rode o `supabase/schema.sql` **atualizado**: ele cria `friendships` e `game_invites`, as funções (`search_users`, `send_friend_request`, `respond_friend_request`, `remove_friend`, `invite_friend`, `dismiss_invite`, `are_friends`) e adiciona as duas tabelas ao **Realtime** (publicação `supabase_realtime`), que é o que faz pedidos e convites chegarem na hora.
- Todas as alterações passam pelas funções (validadas no servidor): só dá para convidar quem é amigo, e cada pessoa só lê as próprias amizades e convites.
- "Online" vem de um canal de presença do Realtime (`kard-presence`), onde cada jogador logado aparece pelo id da conta.
- Convites valem por 15 minutos (quem abrir o app nesse tempo ainda vê o convite).

## 7. Relatório de problemas do motor (de todos os jogadores)

Os apps dos jogadores enviam para o Supabase os problemas do motor de regras que acontecem nas partidas (texto de carta não entendido, erros internos, ajustes manuais, relatos). Assim você corrige problemas de partidas em que não estava.

1. Rode o `supabase/schema.sql` **atualizado** de novo (SQL Editor → New query → cole tudo → Run). Ele cria `engine_issues`, `engine_issue_reporters`, `app_admins` e as funções `report_engine_issues`, `list_engine_issues` e `is_app_admin`.
2. Torne a sua conta administradora (troque pelo e-mail da sua conta no Kard) e rode:
   ```sql
   insert into public.app_admins (user_id) select id from auth.users where email = 'seu@email.com';
   ```
3. Reinicie o app logado nessa conta → **Configurações → Problemas do motor** → aba **🌐 Todos os jogadores**.
4. **📋 Copiar relatório** e cole na conversa com quem vai corrigir o motor. Depois de publicar a versão corrigida, **Remover corrigidos** apaga do Supabase o que o motor já entende.

Como funciona:
- Só jogadores **logados** enviam. Sem login ou sem internet, os problemas ficam numa fila e vão na próxima vez.
- Os jogadores só conseguem **enviar** (pela função, com limite de tamanho); ninguém além dos administradores lê a tabela.
- Os nomes dos jogadores são trocados por "Jogador 1", "Jogador 2"... Cada um pode desligar o envio em Configurações.
- Problemas iguais são agrupados: a tabela guarda o contador, quantos jogadores diferentes viram e até 3 exemplos com as últimas jogadas.

## 8. Juiz IA e bot (Edge Function "ai")

As partidas são manuais. O **Juiz IA** (botão "Chamar o juiz" em cada linha do histórico) e o **bot do Teste de deck** usam uma IA que fica **no servidor**, não no computador de cada jogador: o app chama a Edge Function `ai` do Supabase, e só ela conhece a chave do provedor. Assim ninguém consegue tirar a chave de dentro do instalador.

**Provedor recomendado (grátis): Groq, modelo `openai/gpt-oss-120b`** — cerca de 1.000 consultas/dia e 30/minuto no plano gratuito (os limites mudam; confira em console.groq.com/settings/limits). O código aceita qualquer provedor compatível com a API da OpenAI (veja "Trocar de provedor").

1. **Chave do Groq:** crie uma conta grátis em https://console.groq.com → **API Keys → Create API Key** → copie (começa com `gsk_`).
2. **Banco:** rode o `supabase/schema.sql` atualizado (cria a tabela `ai_usage`, o limite diário por jogador).
3. **Publicar a função** (no terminal, na pasta do projeto):
   ```bash
   npx supabase login
   npx supabase link --project-ref SEU-PROJECT-REF      # o "ref" está na URL: https://SEU-PROJECT-REF.supabase.co
   npx supabase secrets set AI_API_KEY=gsk_sua_chave
   npx supabase functions deploy ai
   ```
   Sem terminal: Supabase → **Edge Functions → Deploy a new function → Via Editor**, nome `ai`, cole o conteúdo de `supabase/functions/ai/index.ts` e publique; depois **Edge Functions → Secrets** → adicione `AI_API_KEY`.
4. **Testar:** no app, logado → **Configurações → Juiz IA e bot → Testar a IA**.

Segredos opcionais da função:

| Segredo | Padrão | Para quê |
|---|---|---|
| `AI_MODEL` | `openai/gpt-oss-120b` | modelo usado |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` | provedor |
| `AI_DAILY_LIMIT` | `80` | consultas por jogador por dia (protege a cota grátis) |

**Trocar de provedor** (só os segredos mudam, o código é o mesmo):

| Provedor | `AI_BASE_URL` | `AI_MODEL` (exemplo) |
|---|---|---|
| Groq (recomendado) | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash-lite` (o Flash grátis tem só ~20 consultas/dia) |
| OpenRouter | `https://openrouter.ai/api/v1` | um modelo terminado em `:free` |
| OpenAI (pago) | `https://api.openai.com/v1` | `gpt-4.1-mini` |

**Só em desenvolvimento** dá para pular a função e chamar o provedor direto, pondo no `.env`: `MAIN_VITE_AI_API_KEY=gsk_...` (veja `.env.example`). **Nunca gere um instalador com essa variável preenchida** — a chave iria junto e qualquer um poderia usá-la.

## 9. Administradores e painel administrativo

O app tem um **painel administrativo** (menu lateral → 🛡 **Administração**, ou no menu da sua conta) que só aparece para administradores. Toda função do painel confere no servidor se quem chama é administrador — esconder o botão é só conveniência; a segurança está no banco.

**Ativar:**

1. Rode o `supabase/schema.sql` atualizado (SQL Editor → cole tudo → **Run**). Pode rodar de novo sem problema.
2. Nomeie o **primeiro** administrador (troque o e-mail pelo da sua conta):
   ```sql
   insert into public.app_admins (user_id) select id from auth.users where email = 'seu@email.com';
   ```
3. Reenvie a Edge Function da IA (ela passa a respeitar suspensões e o limite definido no painel):
   ```bash
   npx supabase functions deploy ai
   ```
4. Saia e entre de novo na conta no app (ou reinicie o app).

**O que o painel faz:**

| Aba | O que tem |
| --- | --- |
| Visão geral | Contas, novas e ativas nos últimos 7 dias, amizades, suspensas, consultas à IA (hoje e 7 dias) |
| Contas | Busca por nome/usuário/e-mail; **suspender** (1, 7, 30 dias ou permanente, com motivo que o jogador vê), remover suspensão, **tornar/tirar admin**, zerar a IA do dia |
| Avisos e IA | **Aviso para todos** (faixa no topo do app; informação ou alerta) e o **limite diário da IA** por jogador, sem precisar reenviar a Edge Function |
| Registro | Quem fez o quê e quando (suspensões, cargos, configurações) |

**Regras de segurança:** o app nunca fica sem administrador; ninguém bane a si mesmo; um administrador precisa perder o cargo antes de ser suspenso. Administradores veem o e-mail das contas — nomeie só pessoas de confiança.

**Conta suspensa:** não usa a IA (a Edge Function recusa), não aparece na busca de jogadores, não pede amizade nem convida, e o app bloqueia o jogo online e os amigos. Coleção, decks e teste de deck continuam funcionando. Observação: o jogo online usa o Realtime direto entre os jogadores; o bloqueio do online é feito pelo app.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| "O login ainda não foi configurado" | `.env` ausente/errado, ou o app não foi reiniciado depois de criar o `.env`. |
| O código não chega | SMTP próprio não configurado (o padrão só envia para membros da equipe) ou caiu no spam. |
| "Muitos e-mails enviados" | Limite de e-mails por hora; aguarde ou aumente em **Rate Limits** (com SMTP próprio). |
| Google abre mas dá erro de redirect | Falta `http://127.0.0.1:53682/auth/callback` nas Redirect URLs do Supabase, ou o URI do Google não é o "Callback URL" do Supabase. |
| Google diz "acesso bloqueado" | App em modo "Testes" no Google e seu e-mail não está em **Usuários de teste**. |
| Erro ao checar nome de usuário | O `schema.sql` não foi executado (falta a função `username_available`). |
| "O perfil ainda não foi configurado no Supabase" | O `schema.sql` atualizado não foi executado (faltam as colunas do perfil ou o bucket `avatars`). |
| "O sistema de amigos ainda não foi configurado" | O `schema.sql` atualizado não foi executado (faltam `friendships`/`game_invites` e as funções). |
| Pedidos/convites só aparecem depois de um tempo | As tabelas não estão na publicação do Realtime: rode o `schema.sql` de novo, ou em **Database → Publications → supabase_realtime** marque `friendships` e `game_invites`. |
| "A Edge Function \"ai\" ainda não foi publicada" | Falta o passo 8.3 (`npx supabase functions deploy ai`). |
| "AI_API_KEY não configurada" | Falta o segredo `AI_API_KEY` da função (passo 8.3). |
| "Limite diário de N consultas" | O jogador passou do `AI_DAILY_LIMIT` (padrão 80/dia). |
| Aba "Todos os jogadores" não aparece | Sua conta não está em `app_admins` (passo 7.2), ou o app não foi reiniciado. |
| Problemas não chegam ao Supabase | O `schema.sql` atualizado não foi executado (falta `report_engine_issues`), o jogador não está logado ou desligou o envio. |

## Próxima etapa

As **partidas online** (1v1 e Commander com 4 jogadores) vão usar o **Supabase Realtime** deste mesmo projeto — sem servidor extra e dentro do plano gratuito (200 conexões simultâneas, 2 milhões de mensagens/mês).
