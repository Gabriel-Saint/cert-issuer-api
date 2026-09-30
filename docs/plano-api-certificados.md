# Plano da API de Emissão de Certificados

## Objetivo e enquadramento

Construir um serviço independente para emitir, consultar, baixar, revogar e verificar certificados de cursos. Cada sistema consumidor permanece responsável por seus alunos, cursos/ofertas, autenticação de usuários e confirmação de conclusão. A primeira integração será com o sistema atual via Supabase, mas a API aceitará qualquer CRM/LMS/backend que forneça o contrato definido.

**Este projeto não é um MVP nem um piloto.** O objetivo é entregar a API completa definida pelos requisitos aprovados. O trabalho pode ser organizado em fases de implementação, mas isso não reduz o escopo do produto nem autoriza iniciar funcionalidades antes da aprovação das especificações.

A API será consumida por backend/Edge Function de qualquer sistema que gerencie alunos e cursos/ofertas; o adapter Supabase é apenas a primeira integração. Segredos nunca serão expostos no navegador. A API não duplica cadastro ou gestão de usuários e não exige nem armazena CPF.

## Decisões aprovadas

### Instituição e cursos

- A implantação inicial atenderá uma instituição, podendo receber integrações de sistemas consumidores diferentes. Dados da instituição/emissor são configurados na API e não escolhidos livremente por cada chamada.
- A API não manterá cadastro de cursos. Cada emissão enviará os dados necessários ao certificado, que serão validados e congelados no snapshot.
- O payload incluirá título do curso, carga horária e data de conclusão. O responsável é opcional: quando houver professor/coordenador designado, enviar nome e cargo em campos explícitos; quando não houver, a emissão não deve ser bloqueada por ausência desses dados.
- A data de conclusão é a data apresentada no certificado; não foi escolhida uma faixa de início e fim do curso.
- O consumidor é responsável pela correção dos dados enviados. Alterações posteriores no Supabase não modificam certificados emitidos.
- Presencial e online usam o mesmo template visual. Para desenvolvimento/staging, usar dados fictícios (`Instituição de Teste`, `Aluno de Teste`, `Curso de Demonstração`), sem logo e com “TESTE — SEM VALIDADE OFICIAL” visível no PDF. O bloco genérico usa linha de assinatura; se houver responsável de teste, imprimir nome/cargo fictícios, e se não houver, omitir a identificação. Dados reais e logo oficial não são necessários para validar emissão/consulta/download/verificação. Antes da produção, substituir placeholders por conteúdo e identidade visual aprovados pelo gestor. Começar com um tipo de certificado comum a todas as ofertas, com possibilidade de adicionar tipos específicos por curso mediante aprovação. Templates são versionados, empacotados com a API e selecionados por lista permitida; o consumidor não envia HTML/CSS nem escolhe instituição ou papel de emissor.

### Identidade, autenticação e autorização

- A integração usa `client_id` e `client_secret`, com assinatura HMAC-SHA256 por requisição, timestamp e nonce. Não haverá troca por token no fluxo normal de integração.
- A autenticação de máquina é obrigatória para endpoints de integração. JWT comum de aluno não autoriza emissão.
- O segredo HMAC precisa estar disponível para recalcular a assinatura. Ele será armazenado cifrado, com a chave de cifragem protegida fora do banco por serviço de segredos/KMS. Guardar somente um hash irreversível do segredo não permite validar HMAC.
- Uma chamada de revogação exige credencial de máquina com escopo `revoke`. O backend/adapter do sistema consumidor valida que a pessoa solicitante é administradora segundo o próprio provedor de identidade. A API registra o identificador do ator recebido e coberto pela assinatura HMAC, mas não consulta nem depende do provedor de identidade do consumidor. A autorização da pessoa é responsabilidade da integração.
- Escopos de credencial são isolados (`issue`, `read`, `revoke`). Uma credencial sem `revoke` não revoga. A implantação inicial atende uma instituição; cada sistema integrado tem um namespace estável de integração para seus IDs externos, mantido durante a rotação de credenciais.
- Cada integração possui um namespace estável para seus identificadores externos. Rotacionar credenciais não altera esse namespace. Integrações que precisem deduplicar as mesmas pessoas/ofertas entre si devem enviar IDs canônicos compartilhados.
- A rotação permitirá duas credenciais ativas durante a troca, seguida da revogação da antiga. Segredos não serão registrados em logs nem armazenados em texto puro.
- TLS é obrigatório. mTLS e allowlist de IP ficam como camadas opcionais a avaliar conforme a infraestrutura de saída do consumidor.

### Idempotência, referência externa e correções

- Toda mutação autenticada exige `Idempotency-Key`, associada à credencial de máquina.
- A regra é um certificado vigente por pessoa e oferta dentro do namespace da integração. Sistemas consumidores diferentes podem usar modelos internos distintos; cada um fornece IDs estáveis no próprio namespace.
- O contrato da emissão recebe `externalStudentId`, `courseId`, `deliveryMode` (`online` ou `in_person`) e `classId` apenas para `in_person`. `classId` é obrigatório no presencial e deve ser omitido no online. São strings opacas sem PII; cada adapter traduz seus IDs locais para esse contrato, sem obrigar a API a conhecer tabelas ou migrations do consumidor.
- A identidade lógica da oferta é formada por namespace estável de integração + `deliveryMode + courseId + classId` quando presencial, e namespace + `deliveryMode + courseId` quando online. A identidade do certificado inclui essa oferta e `externalStudentId`. A API valida os campos, mas não consulta o catálogo externo nem verifica se a turma pertence ao curso; o adapter autenticado garante essa relação. Integrações que precisem deduplicar as mesmas pessoas/ofertas devem enviar IDs canônicos compartilhados.
- Repetir uma requisição com a mesma chave e os mesmos dados retorna o resultado da emissão existente, inclusive se a emissão ainda estiver em processamento, de acordo com o estado documentado.
- Reutilizar uma `Idempotency-Key` com payload diferente resulta em conflito, sem nova emissão.
- Reenviar a mesma referência com os mesmos dados retorna o certificado existente. Reenviar a referência com dados diferentes resulta em conflito; não altera snapshot nem PDF já emitidos.
- Certificados emitidos são imutáveis. Uma correção exige uma operação explícita de reemissão, com motivo e vínculo histórico entre o certificado substituído e o novo. O novo certificado é gerado primeiro; somente após sua emissão bem-sucedida o anterior passa a `SUPERSEDED`/revogado. Ambos permanecem no histórico, e a operação deve garantir que nunca existam dois certificados vigentes para a mesma referência. Reemissões usam a mesma referência externa e exigem nova chave de idempotência.
- Segunda via significa permitir novo download do mesmo certificado, preservando código de verificação e número de registro. Não cria nova emissão.
- Falhas e retries precisam ter comportamento definido para `PROCESSING`, `FAILED` e emissão presa. A mesma chave não pode gerar duplicatas. A estratégia de retomada/reconciliação será definida no Design.

### Registro, código e documento

- O código de verificação usa CSPRNG com pelo menos 128 bits de aleatoriedade e constraint única no PostgreSQL. Colisões são tratadas com retry.
- O número de registro segue uma sequência por instituição e ano, por exemplo `2026-000123`, e é alocado atomicamente. Lacunas são aceitáveis: um número reservado não será reutilizado após falha.
- A sequência é protegida por constraints no banco e não depende de uma transação aberta durante renderização do PDF ou upload.
- Cada certificado preserva snapshot imutável dos dados, `templateVersion`, metadados do PDF e hashes necessários para auditoria e verificação.
- O código e o QR apontam para a verificação online oficial. Não são, isoladamente, assinatura digital nem prova de que os dados enviados pelo sistema consumidor eram verdadeiros.
- A verificação online é a fonte de verdade do status. Assinatura assimétrica para validação offline pode ser avaliada futuramente se houver requisito. ICP-Brasil está fora do escopo atual.
- Nenhuma comunicação deve alegar que um PDF é impossível de falsificar. SHA-256 detecta diferenças em relação ao arquivo original conhecido; a confiança depende de proteger a API, o banco, o storage e as credenciais.

### Download, storage e volume

- O PDF será guardado em bucket privado de object storage compatível com S3; PostgreSQL continua sendo a fonte dos metadados e estados.
- O endpoint autoriza o download e retorna URL pré-assinada de curta duração, prevista entre 1 e 5 minutos. O bucket não será público.
- Os PDFs ficarão em um projeto Supabase separado, exclusivo para storage da API, sem compartilhar o projeto Supabase do sistema consumidor. Essa separação é uma decisão de segurança importante: as credenciais S3 têm acesso amplo a todos os buckets do projeto e ignoram RLS; isolar o projeto reduz o impacto de vazamento. As credenciais desse projeto serão usadas somente no servidor da API.
- Supabase Storage não oferece versionamento S3. Os objetos terão chaves únicas e imutáveis, sem sobrescrita. Foi decidido não manter cópia de backup independente dos PDFs; esse risco de perda/indisponibilidade dos objetos é aceito e deve estar documentado. O backup do Railway não cobre os PDFs no Supabase.
- Railway é a preferência para hospedar a API e o PostgreSQL, usando o backup nativo do Railway para o banco, sem cópia externa adicional do PostgreSQL. Infraestrutura deve confirmar ativação, retenção de 30 dias e testar restauração antes da produção. O domínio e os casos de uso permanecem desacoplados do banco por ports/adapters; a implementação de persistência, migrations, constraints e testes assume PostgreSQL, sem prometer troca de banco sem custo. Região não está definida e não há exigência geográfica informada.
- A estimativa inicial é de 1.000 a 20.000 emissões por mês. O alvo inicial de pico é até 10 requisições por segundo, incluindo consultas, sujeito a validação por teste de carga.
- A emissão começará síncrona somente se medições demonstrarem que renderização e upload cabem com folga nos limites do consumidor síncrono inicial. Caso contrário, o contrato usará `202 Accepted` e consulta de estado; esse comportamento não dependerá de Edge Function específica.

### Privacidade e retenção

- CPF não faz parte do escopo. Nome, identificadores externos e certificados ainda são dados pessoais e exigem controles de acesso e retenção.
- Política de retenção adotada para o projeto: manter certificado/registro enquanto precisar ser verificável; auditoria por 5 anos; logs técnicos por 90 dias; backups nativos do PostgreSQL no Railway por 30 dias. Esses são prazos operacionais do projeto, não parecer jurídico; se houver obrigação legal diferente, atualizar a política. Não haverá exclusão de certificado pela API: revogação preserva o histórico. Pedidos válidos de exclusão/anomização seguem processo controlado, sem apagar indevidamente evidências necessárias.
- Logs técnicos e trilha de auditoria são separados. Não registrar segredo, CPF ou payload completo.
- A auditoria registra ator da integração, evento, instante UTC, request/correlation id, referência externa e resultado. A trilha é append-only na aplicação, mas isso não a torna imutável contra um administrador do banco.
- Retenção, acesso, exportação, exclusão, restauração e eventual evidência WORM/hash-chain precisam ser definidos de acordo com os requisitos legais e operacionais.
- A política deve especificar como atender pedidos válidos de eliminação/anomização sem apagar indevidamente evidências de emissão, revogação e verificação.

## API proposta

Todas as rotas privadas usam autenticação de máquina e escopos próprios, independentemente da tecnologia do consumidor. O contrato final, DTOs, limites e erros serão publicados em OpenAPI. O primeiro adapter pode ser uma Edge Function Supabase, mas isso não é requisito da API.

- `POST /v1/certificates`: solicita emissão com `Idempotency-Key`, `externalStudentId`, `courseId`, `deliveryMode`, `classId` (obrigatório somente no presencial), nome do aluno, título, carga horária, data de conclusão, responsável opcional e tipo de certificado permitido. A instituição e a versão do template são determinadas no servidor.
- `GET /v1/certificates/{id}`: consulta estado e metadados autorizados.
- `GET /v1/certificates/by-reference/{externalReference}`: localiza certificado da referência com autorização adequada.
- `GET /v1/certificates/{id}/pdf`: autoriza e devolve URL pré-assinada de curta duração para o PDF privado.
- `POST /v1/certificates/{id}/revoke`: revoga com motivo obrigatório, escopo `revoke`, ator autenticado pelo consumidor e registro histórico. Não há exclusão física.
- `POST /v1/certificates/{id}/reissue`: operação autenticada e idempotente para corrigir dados; recebe motivo, cria novo certificado ligado ao anterior e só marca o anterior como substituído depois que o novo for emitido com sucesso.
- `GET /v1/public/certificates/{code}`: verifica status sem autenticação e retorna dados públicos mínimos: status, nome, título do curso e instituição. Não expõe PDF nem metadados adicionais sem decisão aprovada.
- `POST /v1/public/certificates/{code}/file-check`: compara o PDF enviado com o hash do original, em streaming e sem armazenar upload; limite inicial de 10 MiB, timeout de 15s e 10 chamadas/minuto por IP.
- `POST /v1/public/certificates/{code}/file-check`: compara o PDF enviado com o hash do original, em streaming e sem armazenar upload; limite de 10 MiB, deadline total de 120s, timeout de inatividade de 15s e até 15s para processamento após o recebimento; 10 chamadas/minuto por IP.

Respostas públicas devem evitar enumeração e expor somente o mínimo necessário. Rate limits de rotas públicas e de integração são separados.

## Arquitetura e estrutura

Adotar Hexagonal / Ports and Adapters como padrão principal, com camadas alinhadas à Clean Architecture. O domínio não importa NestJS, Prisma, S3, Playwright nem detalhes de hospedagem. NestJS atua como composition root.

DDD tático seletivo para regras reais: Certificate, Snapshot, VerificationCode, Registry, transições e erros de domínio. Usar Repository e Unit of Work onde forem necessários para persistência e invariantes transacionais. Evitar CQRS completo, microserviços internos, Redis e event bus sem necessidade medida.

Ferramentas propostas: `@nestjs/swagger` gera o contrato OpenAPI e Swagger UI; OpenAPI é a fonte do contrato para qualquer adapter consumidor. Usar `class-validator`/`class-transformer` nos DTOs HTTP. Prisma é o ORM do adapter PostgreSQL e não pode ser importado pelo domínio; migrations Prisma podem conter SQL customizado para índices parciais e outras constraints específicas. Testes com Jest/Supertest e PostgreSQL real via Testcontainers.

Execução local é requisito: `docker compose` sobe PostgreSQL e S3Mock como emulador S3 para testes; a API usa Chromium/Playwright local e dados sintéticos. O fluxo de desenvolvimento emite, consulta, baixa e verifica PDF sem Railway, Supabase ou credenciais de nuvem. S3Mock aceita URLs pré-assinadas mas não valida assinatura/expiração; essas propriedades precisam de teste no adapter Supabase/staging. `.env.example` usa credenciais locais separadas de produção.

Estrutura sugerida para o serviço:

```text
api-certificados/
├─ src/
│  ├─ main.ts
│  ├─ app.module.ts
│  ├─ config/
│  ├─ modules/
│  │  ├─ certificates/
│  │  │  ├─ domain/
│  │  │  │  ├─ entities/
│  │  │  │  ├─ value-objects/
│  │  │  │  ├─ errors/
│  │  │  │  └─ ports/
│  │  │  ├─ application/
│  │  │  │  ├─ use-cases/
│  │  │  │  └─ ports/
│  │  │  ├─ presentation/http/
│  │  │  │  ├─ controllers/
│  │  │  │  ├─ dto/
│  │  │  │  └─ mappers/
│  │  │  ├─ infrastructure/
│  │  │  │  ├─ persistence/
│  │  │  │  ├─ storage/
│  │  │  │  ├─ renderer/
│  │  │  │  └─ templates/
│  │  │  └─ certificates.module.ts
│  │  ├─ machine-auth/
│  │  └─ health/
│  └─ shared/
├─ prisma/
│  └─ migrations/
├─ test/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ docs/specs/certificate-api/
│  ├─ requirements.md
│  ├─ design.md
│  └─ tasks.md
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
└─ README.md
```

As portas pertencem à fronteira de aplicação/domínio conforme a regra representada; adapters concretos ficam em infraestrutura. Evitar abstrações genéricas sem benefício demonstrável.

## Fluxo robusto de emissão

1. Validar assinatura HMAC, timestamp, nonce, escopo da credencial e payload.
2. Reservar atomicamente `Idempotency-Key` e criar emissão `PROCESSING` em transação curta.
3. Alocar código aleatório e número de registro, protegidos por constraints únicas e retry em colisão.
4. Congelar snapshot e versão do template.
5. Renderizar PDF fora de transação longa.
6. Fazer upload privado com chave imutável e calcular SHA-256 do arquivo.
7. Finalizar como `ISSUED` em transação curta, persistindo hashes, referências e evento de auditoria.
8. Em falha, registrar `FAILED` e executar compensação/reconciliação de objetos órfãos ou emissões presas.
9. Repetições idempotentes retornam o mesmo resultado. Uma chave ou referência reapresentada com conteúdo incompatível resulta em conflito, não em uma segunda emissão implícita.

A forma exata de reservar/retomar estados e reemitir após correção será definida no Design, preservando atomicidade sem manter transação PostgreSQL durante Chromium ou chamadas ao storage.

## Segurança da assinatura HMAC

A canonicalização v1 é detalhada no Design: `X-Client-Id`, método, path sem query, timestamp, nonce, `Idempotency-Key` e SHA-256 dos bytes brutos do corpo. Rotas privadas rejeitam query string; a API e cada adapter devem assinar exatamente a mesma representação e compartilhar vetores de teste.

A API aceita timestamp com desvio máximo de ±300s, nonce base64url de 16 bytes CSPRNG com reserva atômica/única e TTL mínimo de 10 minutos; rejeita replay e compara assinaturas em tempo constante. Segredos/assinaturas não aparecem em logs. A rotação permite sobreposição limitada sem alterar o namespace da integração.

A segurança também inclui TLS, rate limiting por cliente, escopos, limites de payload/arquivo, proteção contra SSRF durante renderização, escape de template, bucket privado, política de credenciais e testes de abuso/replay.

## Auditoria, privacidade e recuperação

A trilha de auditoria registra emissão, revogação, falhas e tentativas relevantes; downloads podem ser auditados conforme decisão operacional. Cada evento inclui ator de integração, ator informado pelo consumidor quando aplicável, evento, timestamp UTC, request/correlation id, referência externa e resultado. Não inclui segredo nem payload completo.

Aplicar os prazos de retenção definidos. Usar backup nativo Railway para PostgreSQL, com retenção de 30 dias e teste de restauração antes da produção. Não manter cópia independente dos PDFs no Supabase; o risco de perda/indisponibilidade sem recuperação própria está aceito. Monitorar falhas, emissões `PROCESSING` presas e objetos órfãos.

## O que reaproveitar do piloto

Os caminhos abaixo são referências do piloto e devem ser verificados na cópia do repositório antes do porte. Reaproveitar conceitos e testes, não dependências do schema interno:

- Caso de uso de emissão: `apps/api/src/application/use-cases/certificate/issue-certificate.use-case.ts`; adaptar snapshot, datas, registro, hash, renderer e storage, removendo acoplamento a `User`, `Course` e `CertificateRequest` locais.
- Código e registry: `apps/api/src/domain/value-objects/verification-code.ts` e `registry.ts`; rever entropia para pelo menos 128 bits.
- Entidade: `apps/api/src/domain/entities/certificate.entity.ts`; adaptar estado, snapshot e dados de revogação/substituição.
- Renderer e templates: `apps/api/src/infrastructure/certificate/playwright-certificate.renderer.ts` e `apps/api/src/infrastructure/certificate/template/`; revisar execução offline, fontes, QR e restrições de rede.
- Storage: `apps/api/src/domain/ports/services/certificate-storage.port.ts`; manter o limite de abstração e criar adapter S3.
- Repositório: `apps/api/src/domain/ports/repositories/certificate.repository.port.ts`; redesenhar para idempotência, estados externos, histórico e auditoria.
- Schema Prisma e spec do piloto não devem ser copiados diretamente quando dependerem de `User`, `Course` ou `CertificateRequest` internos.
- `apps/api/src/certificates.e2e.spec.ts` e `apps/api/src/testing/in-memory-certificates.ts` são referências para doubles e testes ponta a ponta.

## Testes e critérios de qualidade

- Testes unitários de parsing/normalização, período/data de conclusão, transições, snapshot, canonicalização, hashes e mapeamento de erros.
- Property-based (`fast-check`) para invariantes de código, normalização, canonicalização, colisões/constraints e idempotência.
- Testes de casos de uso com ports/fakes: emissão, retry, payload divergente, duplicidade, revogação, reemissão vinculada e falhas de renderer/storage/compensação.
- E2E HTTP (Jest/Supertest): autenticação de máquina e escopos, validação DTO, estados, emissão/consulta/download/revogação/verificação, replay, rate limit e privacidade.
- Integração real com Testcontainers: migrations/constraints concorrentes em PostgreSQL; upload/download/falhas em S3 compatível; Chromium real para conteúdo, layout e hash.
- Validar o documento OpenAPI gerado por `@nestjs/swagger` e o payload do adapter inicial; o contrato permanece independente do consumidor.
- Segurança: emissão anônima, escopo insuficiente, replay e nonces concorrentes, enumeração, SSRF/template injection, PII em logs e exposição indevida do PDF.
- Gate de PR: lint, typecheck, testes unitários/property/e2e e build. Postgres, S3 e Chromium devem ter serviços/containers no CI.
- Antes de produção: staging ponta a ponta, teste de restauração de backup, validação de limites/timeout e runbook operacional.

## Fluxo spec-driven e commits

Nenhuma implementação começa antes de Requirements, Design e Tasks estarem escritos e aprovados. Mudança de requisito ou escopo atualiza a spec e o plano antes de alterar código.

Fluxo obrigatório: Requirements → Design → Tasks → aprovação do checkpoint → implementação da menor tarefa coesa → testes definidos para ela → revisão/aceite. Cada task identifica requisitos, critérios verificáveis e testes. Não marcar tarefa concluída sem executar os gates aplicáveis; registrar validação impossível. Não criar commits intermediários: o usuário fará os commits ao final de todo o trabalho.

Quando o usuário for commitar ao final, usar Conventional Commits em português no imperativo, por exemplo `feat(api): adiciona emissão idempotente de certificados`, `feat(infra): adiciona armazenamento privado em S3`, `test(api): cobre concorrência e repetição` e `docs(api): publica contrato OpenAPI`. Não executar `git add`, não criar commits e não adicionar trailer `Co-authored-by`.

## Fases de implementação

As fases organizam a entrega do projeto completo e não representam MVP/piloto nem reduzem o escopo aprovado.

1. Especificação: Requirements, Design e Tasks; contrato, modelo de ameaças, retenção, volume, SLA, RPO/RTO e aceite. Confirmar Railway/PostgreSQL, storage S3, limites do Supabase e isolamento.
2. Fundação: serviço NestJS isolado, arquitetura modular, `/v1`, OpenAPI, migrations, health/readiness e pipeline CI.
3. Contrato e autenticação: HMAC, canonicalização, escopos, rotação, rate limit, idempotência e integração inicial da Edge Function.
4. Domínio e persistência: snapshot, templates versionados, estados, registry, constraints, auditoria, reemissão e histórico.
5. Renderer e storage: Playwright/templates, adapter S3 privado, chaves imutáveis e reconciliação de objetos órfãos.
6. Endpoints: emissão, consulta, PDF, revogação e verificação pública, com privacidade e limites.
7. Validação: unit/property/e2e/integração, concorrência, falhas, carga, restore de backup e staging Supabase ponta a ponta.
8. Produção: deploy separado, secret manager, dashboards/alertas, runbook, retenção e processo de incidentes.

## Pendências para aprovação da spec

- Para desenvolvimento/staging, usar os placeholders e a marca “TESTE — SEM VALIDADE OFICIAL”; isso não depende do gestor nem bloqueia testes. Antes da produção, gestor aprova texto/dados reais/logo/assinatura. Começar com um `certificateType` comum; tipos específicos por curso podem ser adicionados depois. Responsável permanece opcional; presencial e online usam o mesmo template.
- Confirmar Railway para hospedagem/PostgreSQL. O storage será Supabase Storage em projeto separado e exclusivo para PDFs; confirmar acesso, credenciais S3 server-side e procedimento de backup/exportação.
- Aplicar os prazos de retenção adotados para o projeto: certificado/registro enquanto verificável, auditoria 5 anos, logs 90 dias e backup PostgreSQL Railway 30 dias. Atualizar somente se surgir obrigação legal ou política institucional divergente; não é uma pendência de definição atual.
- Validar a meta interna de disponibilidade de 99,5% ao mês, RTO de até 24h e RPO de até 24h. São metas provisórias de planejamento, não SLA contratual; dependem do provedor, dos backups e de teste de restauração.
- Confirmar volume de consultas, pico de até 10 req/s, limites de timeout da Edge Function e duração máxima de renderização com testes de carga e staging.
- Validar por vetores compartilhados, testes de abuso e carga os defaults HMAC, limites, erros RFC 9457 e rate limits especificados no Design; ajustar somente se a validação apresentar evidência.
- Definir provisionamento administrativo, revogação e auditoria de credenciais, além de processo de rotação.
- Implementar e testar o adapter inicial Supabase para os campos genéricos. A API e seu contrato devem permanecer independentes do CRM/Supabase; outros adapters podem mapear IDs próprios sem alterar a API.
- Ativar/configurar o backup nativo PostgreSQL Railway com retenção de 30 dias e testar restauração antes da produção. Não criar cópia independente dos PDFs; risco aceito.
