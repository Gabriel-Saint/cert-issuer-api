# Design: API de Emissão de Certificados

**Status:** Baseline aprovada pelo usuário para implementação e teste local em 2026-09-29; gates de produção permanecem pendentes.

## 1. Contexto e restrições

Este documento define a arquitetura aprovada para a fundação local de [Requirements](requirements.md) e `docs/plano-api-certificados.md`. O projeto completo será um serviço NestJS modular, independente do CRM/LMS consumidor. Qualquer sistema backend que tenha IDs de pessoa/curso/oferta compatíveis pode integrar; Supabase é somente o primeiro adapter. Credenciais/branding reais e deploy produtivo exigem seus gates próprios.

Decisões registradas: Railway é preferência para API/PostgreSQL; PDFs ficam em projeto Supabase Storage separado; uma instituição inicial; um tipo de certificado inicialmente; mesmo template visual presencial/online; sem CPF; sem exclusão física. O contrato usa IDs opacos `externalStudentId`, `courseId`, `deliveryMode` e `classId` condicional; cada adapter traduz seu próprio modelo, sem alterar o schema do consumidor. Retenção operacional definida: certificado enquanto verificável, auditoria 5 anos, logs 90 dias e backup PostgreSQL Railway 30 dias. Usa-se backup nativo Railway para PostgreSQL; não haverá cópia independente dos PDFs, risco aceito.

## 2. Arquitetura

Um serviço modular NestJS, com `/v1`, sem microserviços internos. NestJS é composition root.

- `domain`: entidades, value objects, transições e regras puras.
- `application`: casos de uso e portas para persistência, storage, renderer, clock, random e auditoria.
- `presentation`: controllers, DTOs, validação, OpenAPI, autenticação e mapeamento de erros. Proposta: `@nestjs/swagger` para gerar OpenAPI/Swagger UI e `class-validator`/`class-transformer` para validação dos DTOs.
- `infrastructure`: PostgreSQL/Prisma, Supabase S3, Playwright, proteção de segredo, clock, CSPRNG e logging.

Hexagonal desacopla domínio dos adapters, mas não garante troca de banco sem custo. Implementação, migrations, constraints e testes assumem PostgreSQL.

Escolha de ORM: Prisma para o adapter de persistência PostgreSQL, limitado a `infrastructure`; domínio e casos de uso dependem de ports, nunca de Prisma. Migrations Prisma podem incluir SQL customizado para índices parciais/constraints específicos do PostgreSQL. Não adotar TypeORM sem uma necessidade concreta diferente.

Estrutura sugerida:

```text
src/
├─ main.ts
├─ app.module.ts
├─ config/
├─ modules/
│  ├─ certificates/
│  │  ├─ domain/{entities,value-objects,errors,ports}/
│  │  ├─ application/{use-cases,ports}/
│  │  ├─ presentation/http/{controllers,dto,mappers}/
│  │  ├─ infrastructure/{persistence,storage,renderer,templates}/
│  │  └─ certificates.module.ts
│  ├─ machine-auth/
│  └─ health/
└─ shared/
```

## 3. Modelo e portas

Modelo lógico proposto:

- `Integration`: namespace estável que identifica o sistema consumidor e a instituição; sobrevive à rotação de credenciais.
- `IntegrationClient`: credencial vinculada ao `Integration`, com client ID, estado, escopos, segredo cifrado/versão e datas de ciclo de vida.
- `UsedNonce`: client ID, nonce e expiração; unicidade por cliente + nonce.
- `RateLimitBucket`: chave de escopo/rota, contagem/tokens e janela/expiração; atualização atômica no PostgreSQL para compartilhar limites entre instâncias.
- `IdempotencyRecord`: cliente, chave, hash canônico, estado, resultado e timestamps; unicidade por cliente + chave.
- `CertificateSeries`: integração/instituição e identidade lógica aluno+oferta, agrupando reemissões. A identidade é `integrationId + externalStudentId + deliveryMode + courseId` para online e inclui `classId` para presencial.
- `Certificate`: série, estado, snapshot, template, código, registro anual, chave/hash PDF e dados de substituição/revogação.
- `RegistrationCounter`: instituição + ano + próximo sequencial, com incremento atômico.
- `AuditEvent`: ator, evento, resultado, request ID, referência e timestamp UTC, sem payload/segredo.

Ports candidatas: repositories específicos, nonce/idempotency store, `RateLimitPort`, registro, storage, renderer, auditoria, proteção de segredo, clock e random. Não criar repositório genérico/UoW sem benefício claro. Constraints de concorrência ficam no PostgreSQL.

## 4. Contrato HTTP proposto

- `POST /v1/certificates` — emissão.
- `GET /v1/certificates/{id}` — consulta privada.
- `GET /v1/certificates/by-reference/{externalReference}` — consulta por referência. `externalReference` é a `identityKey` SHA-256 hexadecimal da identidade canônica, retornada na emissão e na consulta privada.
- `GET /v1/certificates/{id}/pdf` — autorização e URL pré-assinada curta.
- `POST /v1/certificates/{id}/revoke` — motivo, escopo e ator informado.
- `POST /v1/certificates/{id}/reissue` — reemissão explícita, motivo e vínculo ao anterior.
- `GET /v1/public/certificates/{code}` — verificação pública mínima.
- `POST /v1/public/certificates/{code}/file-check` — comparação hash, sem persistir upload.

Rotas privadas exigem HMAC/escopo; públicas têm rate limits próprios. URL assinada não é persistida nem registrada em logs. DTOs, limites e catálogo final de erros são parte do Design aprovado. O contrato não depende de Supabase, CRM, LMS ou nomes de tabelas do consumidor.

Payload genérico de emissão (IDs serializados como strings; não usar CPF, nome ou e-mail como identificadores):

```json
{
	"externalStudentId": "<id-estavel-da-pessoa>",
	"courseId": "<id-do-curso>",
	"deliveryMode": "in_person",
	"classId": "<id-da-turma>"
}
```

Para online, enviar `deliveryMode: "online"`, `courseId` e omitir `classId`. A API rejeita `in_person` sem `classId` e `online` com `classId`. O discriminador já separa as modalidades; não é necessário prefixar IDs. A Edge Function mapeia IDs existentes sem exigir tabelas/migrations no Supabase. O consumidor é responsável por garantir que `classId` pertença ao `courseId`; a API não consulta o cadastro Supabase.

Para online, enviar `deliveryMode: "online"`, `courseId` e omitir `classId`. A API rejeita `in_person` sem `classId` e `online` com `classId`. Todos os IDs são serializados como strings. Cada adapter mapeia seu identificador estável de pessoa para `externalStudentId`, seu curso de catálogo para `courseId` e, no presencial, a turma para `classId`. O adapter é responsável por garantir que a turma pertença ao curso; a API não consulta o catálogo externo.

## 5. HMAC e proteção de credenciais

Todas as rotas privadas usam `X-Client-Id`, `X-Timestamp`, `X-Nonce` e `X-Signature`. Mutations também exigem `Idempotency-Key` UUID canônico. Segredos de teste e produção são diferentes. O segredo HMAC é gerado com 32 bytes aleatórios; a representação provisionada é mantida em segredo e usada pelo consumidor/API como bytes UTF-8, sem normalização.

Canonicalização v1. Rotas privadas não aceitam query string; consultas usam path params definidos no contrato. O path assinado é o origin-form path recebido, sem query, em ASCII canônico, sem dot segments ou barras invertidas; percent-encoding, se necessário, usa UTF-8 e dígitos hexadecimais maiúsculos. O proxy não pode reescrever o path. Corpo é assinado pelos bytes brutos recebidos antes do parsing JSON.

Mutations JSON exigem `Content-Type: application/json` com UTF-8; `Content-Encoding` deve estar ausente ou ser `identity` em rotas privadas v1. Corpos comprimidos são rejeitados para evitar diferença entre bytes assinados e bytes validados.

```text
cert-api-hmac-v1\n{CLIENT_ID}\n{METHOD}\n{PATH}\n{TIMESTAMP}\n{NONCE}\n{IDEMPOTENCY_KEY_OR_EMPTY}\n{HEX_SHA256_RAW_BODY}
```

Codificação UTF-8, separadores LF e sem LF final. `CLIENT_ID` é o valor exato de `X-Client-Id`; `METHOD` em maiúsculas; `TIMESTAMP` Unix seconds decimal sem zeros à esquerda; `NONCE` base64url sem padding contendo 16 bytes CSPRNG; `IDEMPOTENCY_KEY_OR_EMPTY` é a UUID canônica lowercase ou string vazia; `HEX_SHA256_RAW_BODY` é SHA-256 lowercase dos bytes recebidos (corpo vazio usa hash do byte array vazio). `X-Signature` é HMAC-SHA256 lowercase hex de 64 caracteres. Comparar em tempo constante. Rejeitar query em rota privada v1 para evitar divergência de canonicalização; se houver necessidade futura, definir v2.

Aceitar timestamp numa janela de ±300 segundos. Registrar `(integrationId, nonce)` atomicamente com constraint única e TTL mínimo de 10 minutos; replay, timestamp inválido ou assinatura incorreta retornam o mesmo erro genérico 401. Segredo armazenado cifrado com chave fora do PostgreSQL; não registrar segredo, assinatura ou cabeçalhos de autenticação. Criar vetores de canonicalização compartilhados e testá-los no adapter consumidor e na API.

## 6. Emissão e idempotência

1. Validar assinatura, nonce, timestamp, escopo e DTO.
2. Reservar idempotência e criar `PROCESSING` em transação curta.
3. Alocar código CSPRNG e número instituição/ano; aceitar lacunas, não reutilizar.
4. Congelar snapshot e template versionado.
5. Renderizar fora da transação, sem rede externa.
6. Fazer upload privado com chave imutável e calcular SHA-256 dos bytes finais.
7. Finalizar `ISSUED` e registrar auditoria em transação curta.
8. Em falha, marcar `FAILED` e reconciliar emissões presas/objetos órfãos.

`Idempotency-Key` é distinta da identidade do certificado e cobre retry da operação HTTP: mesma chave + corpo igual retorna estado/resultado; mesma chave + corpo diferente retorna conflito. A identidade lógica inclui `integrationId`: `(integrationId, externalStudentId, deliveryMode, courseId)` para online e `(integrationId, externalStudentId, deliveryMode, courseId, classId)` para presencial. Identidade e conteúdo iguais retornam o certificado vigente; identidade igual com conteúdo diferente conflita e exige endpoint explícito de reemissão. Para deduplicar entre integrações, elas precisam compartilhar IDs canônicos e namespace aprovado.

Para a constraint única no PostgreSQL, não depender da semântica de `NULL` em índice composto: usar chave canônica normalizada ou índices parciais separados para online e presencial. A escolha será validada com testes de concorrência.
`identityKey` é o hash SHA-256 da serialização canônica da tupla de modalidade/IDs e nunca é nulo. A migration cria `UNIQUE (integrationId, identityKey)`, um CHECK que exige `classId` nulo para online e presente para presencial, e índices únicos parciais por `seriesId` para `PROCESSING` e `ISSUED`. Isso permite somente um processamento e um certificado vigente por série, inclusive sob concorrência.

### Reemissão

Manter certificado anterior vigente durante processamento. Após renderização/upload bem-sucedidos, em uma transação curta finalizar novo certificado, marcar anterior `SUPERSEDED`, atualizar série e gravar auditoria. Falha não substitui certificado anterior. Invariante/constraint deve impedir dois vigentes para a mesma série. Nova emissão usa nova `Idempotency-Key` e o motivo é obrigatório.

## 7. Renderer e storage

- Templates versionados no repositório, mesmo visual entre modalidades, inicialmente um `certificateType` allowlisted.
- Fixture de desenvolvimento/staging usa `Instituição de Teste`, `Aluno de Teste`, `Curso de Demonstração`, sem logo, e imprime “TESTE — SEM VALIDADE OFICIAL”. Responsável de teste é opcional; se informado, nome/cargo também são fictícios.
- Configuração produtiva não pode usar os placeholders; identidade visual, dados institucionais reais e assinatura final exigem aprovação do gestor antes do deploy produtivo.
- Playwright/Chromium com fontes locais, conteúdo escapado e acesso de rede externo bloqueado.
- Porta de storage usa adapter S3 compatível: em produção, credencial server-side do projeto Supabase exclusivo da API; localmente, S3Mock via Docker Compose. Bucket privado, chaves únicas não derivadas de PII, sem sobrescrita.
- URL pré-assinada de 1 a 5 minutos, validada em integração. Supabase Storage não tem versionamento S3.
- URL pré-assinada de 1 a 5 minutos, validada em integração. Supabase Storage não tem versionamento S3. S3Mock permite testar upload/download, mas não valida a assinatura nem a expiração da URL; testar isso com o adapter de produção em staging.
- Não haverá cópia independente dos PDFs. O backup Railway cobre somente PostgreSQL, não o storage Supabase; a perda/indisponibilidade de objetos sem recuperação independente é risco operacional aceito e documentado.
- `file-check` processa em streaming com tamanho/timeout/rate limit definidos após análise de risco/carga; não guarda upload.

## 8. Privacidade, auditoria e erros

Dados públicos mínimos: status, nome, título da oferta e instituição. Sem e-mail, referência externa, PDF ou auditoria pública. Logs sem corpo completo, segredo, assinatura ou URL pré-assinada; request ID para correlação.

Política operacional de retenção: certificado/registro enquanto precisar ser verificável, auditoria 5 anos, logs técnicos 90 dias e backup nativo do PostgreSQL Railway por 30 dias. Esses prazos não constituem parecer jurídico e devem ser atualizados se houver obrigação legal/institucional divergente. Revogação conserva histórico; pedidos válidos de exclusão/anomização passam por processo controlado.

Limites de entrada: JSON até 64 KiB; IDs externos 1–128 caracteres UTF-8; nome do aluno até 200; título do curso até 300; responsável até 200 e cargo até 100 quando informados; horas como inteiro de 1 a 10.000; data de conclusão `YYYY-MM-DD`; motivo de revogação 1–1.000 caracteres. `file-check` aceita apenas PDF até 10 MiB em streaming, sem persistir upload; deadline total de 120s, timeout de inatividade durante recebimento de 15s e processamento de até 15s depois do upload completo.

Rate limits iniciais por token bucket, com chaves estáveis e contadores atômicos compartilhados entre instâncias (adapter PostgreSQL; sem Redis): todas as rotas privadas 600 req/min por integração, burst 30; emissões/reemissões/revogações 60/min por integração, burst 5; verificação pública 120/min por IP, burst 30; `file-check` 10/min por IP, burst 2. IP considera forwarded headers somente de proxies confiáveis. Retornar `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; em 429 incluir `Retry-After`. Recalibrar após teste de carga/abuso.

Erros usam `application/problem+json` (RFC 9457) com `type`, `title`, `status`, `detail` seguro, `code` estável, `requestId` e `errors` por campo quando aplicável. Mapeamento: 400 `VALIDATION_ERROR`/`MALFORMED_REQUEST`; 401 `AUTHENTICATION_FAILED` (inclui assinatura, timestamp e replay); 403 `INSUFFICIENT_SCOPE`; 404 `NOT_FOUND` (resposta pública indistinguível para código inválido); 409 `IDEMPOTENCY_CONFLICT`/`CERTIFICATE_CONFLICT`/`STATE_CONFLICT`; 413 `PAYLOAD_TOO_LARGE`; 415 `UNSUPPORTED_MEDIA_TYPE`; 422 `INVALID_TRANSITION`/`UNSUPPORTED_CERTIFICATE_TYPE`; 429 `RATE_LIMITED`; 408 `REQUEST_TIMEOUT` para os deadlines de `file-check`; 500 `INTERNAL_ERROR`; 503 `DEPENDENCY_UNAVAILABLE`. Nunca incluir stack trace ou segredo; 429/503 incluem `Retry-After` quando aplicável.

## 9. Operação e testes

Metas provisórias: 99,5% mensal, RTO ≤24h, RPO ≤24h, até 10 req/s e 1.000–20.000 emissões/mês. Não são SLA contratual; validar com carga e restauração real. Medir p50/p95/p99 de emissão incluindo Edge Function, Chromium e storage; escolher síncrono ou 202 com base no timeout real.

Testes: Jest para unitários e property-based; Supertest para HTTP; Testcontainers com PostgreSQL real para migrations/constraints concorrentes; integração S3 e reconciliação; Chromium/layout/escaping/SSRF; E2E emissão-consulta-download-verificação-revogação-reemissão; limites públicos; carga; restauração do PostgreSQL Railway e verificação de acesso aos objetos Supabase. Não há restore de PDF independente, pois cópia de backup foi explicitamente dispensada.

Em desenvolvimento/staging, usar dados sintéticos, credenciais e recursos separados da produção; verificar a marca “TESTE — SEM VALIDADE OFICIAL” no PDF e validar que a configuração produtiva rejeita placeholders.

## 10. Aprovações pendentes

1. Produção: gestor aprova conteúdo/tipos finais, instituição, identidade visual e assinatura antes do deploy produtivo. Essa aprovação não bloqueia testes com placeholders em desenvolvimento/staging.
2. Integração inicial: testar o adapter Supabase. Outros CRM/LMS/plataformas podem implementar adapters próprios sem mudar domínio ou contrato da API.
3. Aplicar os prazos operacionais de retenção definidos e atualizar somente se houver obrigação legal/institucional diferente; manter processo controlado de exclusão/anomização.
4. Infra: configurar e testar o backup nativo Railway do PostgreSQL com retenção de 30 dias. A ausência de cópia independente dos PDFs é risco aceito, não decisão pendente.
5. Design técnico: canonicalização/TTL, DTOs/limites/erros, provisionamento/rotação de credenciais e escolha síncrona/assíncrona.

**Não iniciar implementação antes da aprovação dos Requirements, deste Design e das Tasks.**

## 11. Execução local

- Docker Compose inicia PostgreSQL e S3Mock; a API pode rodar em modo watch no host ou container, usando Chromium/Playwright local.
- `.env.example` contém apenas valores de desenvolvimento: URL do PostgreSQL local, endpoint/credenciais fictícias do S3Mock, bucket de teste, URL pública local e configuração de proteção de segredo de desenvolvimento. Nunca apontar esse perfil para banco/bucket de produção.
- Um seed local cria uma integração de teste e dados sintéticos (`Instituição de Teste`, `Aluno de Teste`, `Curso de Demonstração`). Segredo gerado é exclusivo do ambiente local; a marca “TESTE — SEM VALIDADE OFICIAL” aparece no PDF.
- README documenta pré-requisitos, comandos para subir/parar containers, inicializar bucket, seed, iniciar API e executar testes.
- Critério de aceite: máquina limpa com Docker e Node instalados consegue, seguindo README, emitir certificado de teste, consultar status, baixar PDF do S3Mock e verificá-lo sem credenciais/acesso à nuvem.
- Critério de aceite: máquina com Docker e Node consegue, seguindo README, emitir certificado de teste, consultar status, baixar PDF do S3Mock e verificá-lo sem credenciais/acesso à nuvem.
- Testes E2E locais usam PostgreSQL e S3Mock em containers; Railway e Supabase só são necessários para integração/staging e validação real de URLs pré-assinadas.
