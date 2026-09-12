# Presença — projeto universitário experimental UFVJM

MVP com backend em **TypeScript estrito, Express, Prisma ORM 7 e PostgreSQL 17**. Front-end em HTML/CSS/JavaScript, sem React. Não representa aprovação oficial da UFVJM, não integra sistemas institucionais e o cadastro não comprova vínculo com a universidade. Nenhuma publicação externa foi realizada.

## Executar localmente

Requer Node.js 22.12+ e npm. Para o PostgreSQL local, mantenha o Docker em execução.

```sh
cd /Users/gabrielvitor/Desktop/pessoal/chamada-ufvjm
npm ci
npm run setup:local
npm run db:up
npm run db:migrate
npm run build
npm start
```

Abra http://127.0.0.1:3017. Para desenvolvimento, use `npm run dev` após a instalação, migração e geração do cliente (`npm run db:generate`).

`setup:local` cria `.env` com senha PostgreSQL e segredo de sessão aleatórios, com permissão de arquivo 0600. Nunca sobrescreve um `.env` existente. `.env.example` mostra as variáveis sem credenciais fixas. O `.env` é carregado automaticamente no backend, nos comandos administrativos e pelo Prisma. Não o inclua no Git. `SESSION_SECRET` deve ser persistente e ter no mínimo 32 caracteres; sua troca invalida sessões antigas.

O Compose sobe apenas o banco deste projeto, em `127.0.0.1:55437`, com volume persistente `chamada-ufvjm_postgres_data`. `docker compose stop` para o banco sem excluir os dados. Não use `docker compose down -v` se quiser preservar o volume. A aplicação continua sendo executada pelo Node no computador.

Para um PostgreSQL já existente, preencha `DATABASE_URL` e `SESSION_SECRET` em `.env`, ignore `db:up` e execute as migrações. `DATABASE_URL` deve apontar para um banco dedicado, no formato `postgresql://USUARIO:SENHA@HOST:PORTA/BANCO`. Codifique caracteres especiais da senha na URL. Em produção use uma conexão TLS verificada conforme o provedor, sem desativar a validação de certificado.

O esquema está em `prisma/schema.prisma` e o histórico SQL em `prisma/migrations/`. **A inicialização não cria tabelas implicitamente:** execute `npm run db:migrate` em cada implantação. Para alterações durante desenvolvimento, edite o esquema e use `npx prisma migrate dev --name descricao`; depois gere o cliente e compile novamente. Nunca use `migrate reset` no banco real.

Contas, presenças, tentativas e sessões ficam no PostgreSQL; fotos continuam em `data/photos/`, privadas, com apenas a referência no banco. `DATA_DIR` personaliza o armazenamento de fotos, não o banco. Mantenha-o fora de `public/` e da raiz publicada pelo proxy. `HOST` padrão: `127.0.0.1`; `PORT`: `3017`.

Na migração desta instalação, o SQLite estava vazio (zero alunos, presenças e tentativas). `data/app.sqlite` foi preservado, mas não é mais acessado pela aplicação. Não há importação automática de outras bases SQLite; caso existam dados em outra instalação, faça exportação/importação controlada antes de trocar de banco. Sessões anteriores não são reutilizadas.

## Estrutura do backend

- `src/app.ts`: rotas Express, validação, autenticação e autorização; acesso a dados via Prisma.
- `src/core.ts`: blocos e cálculo de distância; `src/types.ts`: tipos da configuração e das sessões.
- `src/db.ts`: cliente Prisma com adaptador PostgreSQL, gravação atômica da presença e retenção.
- `src/session-store.ts`: armazenamento de sessões PostgreSQL via Prisma.
- `src/server.ts`: inicialização e encerramento do processo.
- `scripts/*.ts`: administrador, retenção, configuração local e verificação de navegador.
- `test/*.test.ts`: testes unitários e de integração com PostgreSQL real.

A compilação usa `strict: true` e gera `dist/`; o cliente Prisma é gerado em `src/generated/prisma/`. Ambos são ignorados no Git. O adaptador segue a [configuração oficial do Prisma 7](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction).

## Criar o primeiro administrador

No próprio servidor, em terminal interativo:

```sh
npm run admin
```

Informe nome, identificador numérico exclusivo (4–20 dígitos) e senha com ao menos 12 caracteres e até 72 bytes. A senha é digitada oculta, com confirmação, sem argumento de linha de comando. O comando cria uma conta administrativa; não promove nem sobrescreve contas existentes. Use o mesmo `DATABASE_URL` da aplicação. Entre pela tela normal de login; as consultas administrativas aparecem para a função `admin`. Para novos administradores, repita o procedimento com outro identificador. Mantenha o acesso ao terminal restrito. Não existe recuperação de senha por e-mail neste MVP.

## Configuração

Edite `config.json` e reinicie. `CONFIG_FILE` pode apontar para outro arquivo. Na ausência de configuração local, o exemplo é usado com aviso demonstrativo.

- `campus.name`: identificação do campus que ficará gravada na presença.
- `campus.latitude`, `campus.longitude`: centro real verificado pelo responsável. **0, 0 é apenas demonstração, não uma coordenada oficial.**
- `campus.radiusMeters`: raio permitido; exemplo de 150 m.
- `campus.maxAccuracyMeters`: precisão máxima aceita; exemplo de 50 m. Acima disso o resultado é “Localização imprecisa”, mesmo se a coordenada parecer fora do campus.
- `campus.demonstration`: mantenha `true` durante a demonstração; use `false` somente após configurar e verificar os valores reais.
- `days`: dias da semana, 0 = domingo até 6 = sábado. Inicialmente todos.
- `blocks`: pares `HH:mm`, ordenados, sem sobreposição, no mesmo dia. Inicialmente 08–10, 10–12, 12–14, 14–16, 16–18, 18–20 e 20–23. Não suporta blocos que atravessam a meia-noite.
- `locationTtlSeconds`: validade da localização obtida para concluir o cadastro (120 s; intervalo aceito 10–300). Só o horário de recebimento do servidor é usado.
- `retention.photosDays`: foto excluída após esse prazo desde o cadastro (90 dias no exemplo).
- `retention.locationsDays`: a localização inicial é excluída e coordenadas e precisão das tentativas são apagadas após esse prazo (30 dias no exemplo). Motivo, horário, finalidade e vínculo de tentativas autenticadas permanecem.
- `publicUrl`: origem fixa da aplicação, sem caminho, parâmetros, credenciais ou fragmento. O QR contém apenas essa URL. Troque-a antes de imprimir o QR definitivo.

O sistema é de um único campus por instalação. Alterações de horários não reescrevem o histórico. Evite mudar blocos durante um dia de funcionamento: a identidade de cada bloco é o par de horários, e uma alteração cria uma identidade diferente. Use instalações separadas para outros campi.

## Regras e coleta

O servidor determina data e bloco em `America/Sao_Paulo`, com início inclusivo e fim exclusivo. 19h59 pertence integralmente a 18–20; 20h00 pertence a 20–23; 23h00 não possui bloco. Não há limite de atraso nem presença antecipada. A restrição `UNIQUE(user_id, local_date, block)` e o `createMany({ skipDuplicates: true })` do Prisma (SQL `ON CONFLICT DO NOTHING`) garantem uma presença mesmo entre conexões concorrentes. Repetições retornam “Presença já registrada”.

No cadastro, o aluno preenche os dados, lê a explicação e toca em validar. O navegador solicita uma leitura atual, e o servidor valida apenas o formato e os limites numéricos das coordenadas e da precisão. No cadastro não há restrição de distância nem de qualidade da precisão: é permitido cadastrar de qualquer lugar. Depois o front-end abre a câmera frontal, sem microfone. Há captura, prévia, refazer, confirmação e cancelamento. A câmera é encerrada após a captura, cancelamento, saída da página ou quando a página fica oculta.

O formulário não é enviado na validação inicial. O cadastro não gera tentativas recusadas por distância ou precisão. A confirmação envia a foto ao servidor, que exige prova recente na sessão; não aceita uma indicação de aprovação fornecida pelo cliente. Se expirar, é necessária nova localização. O cadastro salva a localização obtida (coordenadas, precisão e instante do servidor) na tabela `registration_locations`, junto da criação da conta e referência da foto, em uma transação. **Não cria presença, mesmo em bloco ativo.** Abrir a página ou entrar na conta também não faz check-in. Cada presença exige tocar em “Registrar presença” e obter uma nova localização; a leitura do cadastro nunca é reaproveitada para chamada.

Nas chamadas, leituras aprovadas não têm coordenadas persistidas: a presença guarda aluno, campus, data local, bloco e instante UTC. Nas recusas autenticadas, o aluno fica vinculado à tentativa. Tanto “fora da área” quanto “imprecisa” são registradas com motivos distintos. Entradas inválidas ou ausência de GPS não geram presença. O histórico pessoal mostra os últimos 1.000 registros; a consulta de alunos até 5.000; tentativas até 1.000. Presenças administrativas e CSV respeitam filtros por data e bloco.

## Proteções implementadas

- Senhas com bcrypt, custo 12, limite de 72 bytes para evitar truncamento silencioso.
- Sessões no PostgreSQL via Prisma, cookies `HttpOnly`, `SameSite=Lax`, validade de 8 horas e `Secure` em produção. Identificador de sessão regenerado no login/cadastro; logout destrói a sessão. Sessões expiradas são removidas a cada 15 minutos.
- Token CSRF de sessão em todas as operações POST (inclusive login/cadastro); verificação da origem quando enviada pelo navegador. Sem CORS aberto.
- Autenticação e autorização no servidor para administração e fotos. Apenas o próprio aluno ou um administrador acessa cada foto, com `Cache-Control: no-store`. Fotos não aparecem automaticamente nas listas: requerem a ação “Ver foto”.
- Helmet e política de conteúdo local; textos do usuário renderizados com `textContent`; consultas Prisma parametrizadas; escape de CSV e neutralização de fórmulas.
- Limite combinado de 20 tentativas de login/cadastro por IP a cada 15 minutos; 20 validações de localização por IP/minuto. Limites estão no `src/app.ts`. São conservadores: redes de campus com muitos usuários sob um IP podem exigir ajuste. O limitador usa memória e é reiniciado com o processo; execute uma instância deste MVP.
- Upload limitado a 2 MB decodificados, JPEG/PNG reais, ao menos 100×100, até 16 milhões de pixels, sem animação. A imagem é decodificada, redimensionada até 640×640 e regravada como JPEG, removendo metadados. Nenhum nome de arquivo enviado pelo usuário é usado.
- Sem logs de requisições, corpos, senhas, fotos ou coordenadas; falhas retornam mensagens genéricas. Não habilite captura de corpos em proxy, monitoramento ou logs externos.

## Retenção e manutenção

A limpeza roda na inicialização e a cada hora. Pode ser executada manualmente:

```sh
npm run cleanup
```

O prazo pode ser excedido em até uma hora com o serviço ligado, ou até a próxima execução se desligado. A localização inicial é excluída da tabela de cadastro ao atingir `locationsDays`. Fotos são removidas do disco e sua referência é anulada; coordenadas e precisão das tentativas são substituídas por `NULL`. Presenças, contas, horários e motivos continuam no histórico. Arquivos órfãos de interrupções são removidos após um dia. A exclusão de foto não impede novas chamadas e não exige nova foto. Falhas de limpeza devem ser corrigidas pelo operador.

A exclusão lógica no PostgreSQL não garante apagamento físico imediato do armazenamento e cópias anteriores podem existir em backups. Restrinja permissões da pasta e dos backups; aplique retenção também nas cópias, use disco criptografado e procedimentos de restauração que não republiquem dados expirados. Não há criptografia própria de banco ou foto nem rotina automática de exclusão da conta/histórico nesta versão. O responsável deve definir prazo e procedimento operacional para esses dados antes do uso real.

## HTTPS e publicação futura

Nenhum serviço externo foi criado. Para hospedar posteriormente:

1. Use servidor com Node 22.12+, PostgreSQL, diretório privado persistente para fotos, uma instância da aplicação e relógio sincronizado. Instale dependências, execute `db:migrate` e `build` antes de iniciar.
2. Configure campus real, `demonstration: false`, domínio com HTTPS em `publicUrl` e um `SESSION_SECRET` persistente e aleatório.
3. Execute com `NODE_ENV=production`. O início é recusado se faltar HTTPS na URL ou se o campus continuar demonstrativo.
4. Coloque um proxy reverso com certificado TLS válido em frente à porta local. Exemplo de configuração Caddy, substituindo pelo domínio real:

```caddyfile
presenca.seu-dominio.example {
    reverse_proxy 127.0.0.1:3017
}
```

5. Para exatamente um proxy confiável, use `TRUST_PROXY=1`. Mantenha a porta Node inacessível externamente; o proxy deve sobrescrever os cabeçalhos encaminhados. Essa configuração permite cookies seguros e o IP correto para o limitador. Não use confiança em proxy se o Node estiver exposto diretamente.
6. Execute o processo por um serviço do sistema, configure backup privado e verifique cadastro, geolocalização, câmera e impressão no aparelho real antes de disponibilizar.

Câmera e geolocalização exigem contexto seguro: HTTPS em produção, ou localhost no próprio computador. Um celular acessando `http://IP-do-computador:3017` normalmente não terá essas APIs disponíveis. Para teste físico use HTTPS com certificado confiável e URL correspondente; não desative a segurança do navegador. O QR está na aba administrativa “QR Code”, com download PNG e impressão.

## Verificação

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:ui
npm audit
```

Testes criam e excluem esquemas isolados com nomes aleatórios no PostgreSQL e diretórios temporários de fotos. Não alteram as tabelas do esquema da aplicação nem `data/`. O usuário de testes precisa de permissão para criar esquemas. Configure `TEST_DATABASE_URL` para um banco separado em CI; não execute a suíte em produção. A suíte Node verifica limites de bloco, fuso e dias, geolocalização, concorrência real com seis clientes Prisma/conexões PostgreSQL, concorrência HTTP, unicidade da matrícula, foto inválida/privada, CSRF, acesso administrativo, cadastro com validação expirada, cadastro fora dos blocos, login/logout, CSV/QR e retenção. A suíte de navegador verifica telas de 390 e 1280 px e fluxo de cadastro, captura/refazer, confirmação, login e chamada com **GPS e câmera simulados**. Não substitui teste real de permissões, GPS, câmera frontal ou impressão em celulares.

## Limitações conhecidas

Sem reconhecimento facial, verificação institucional, disciplinas, turmas, recuperação de senha, aprovação de cadastro ou garantia antifraude. A localização fornecida pelo navegador pode ser adulterada. A foto não é comparada à pessoa nas chamadas; presença é validação pontual, não comprovação de permanência durante o bloco. Localizações próximas ao limite são classificadas pela coordenada central após verificar precisão máxima; o raio não é ampliado pela margem de erro. Disponibilidade e precisão variam por dispositivo, ambiente e permissões.

MVP para escala pequena em uma instância, com PostgreSQL e armazenamento persistente de fotos. Mudanças operacionais, retenção de contas, atendimento aos titulares e responsabilidades pelo tratamento devem ser definidas pelo responsável antes do uso real.

Validação da migração: compilação TypeScript e 17 testes passaram em PostgreSQL, além do fluxo responsivo no Chromium. `npm audit` não apontou vulnerabilidades na instalação verificada. Overrides de `deepmerge-ts` e `mysql2` atualizam dependências transitivas do CLI Prisma; não há uso de MySQL pela aplicação.

## Se a localização expirar no navegador do editor

Abra http://127.0.0.1:3017 no Chrome ou Safari externo. Autorize a localização do site e confira os Serviços de Localização do macOS para o navegador. A aplicação tenta uma leitura precisa por 20 segundos; em caso de indisponibilidade ou timeout, tenta outra leitura atual por até 15 segundos, sem exigir alta precisão do dispositivo. A precisão retornada continua sendo validada no servidor, com o mesmo limite. Não há coordenadas fictícias nem presença concedida sem localização. Permissão negada não dispara uma segunda solicitação.

O campus demonstrativo em 0°, 0° também precisa ser substituído pelo centro real antes de registrar presença no campus. PostgreSQL e Docker não alteram as permissões de geolocalização.
