# Tasks: API de Emissão de Certificados

**Status:** Implementação inicial autorizada pelo usuário em 2026-09-29. T1.1/T1.2 estão em andamento para execução local; production gates não estão aprovados.

## Regra de execução

O usuário aprovou o checkpoint para começar a fundação e testes locais. Esta é a construção do projeto completo, não um MVP/piloto. Endpoints e deploy de produção continuam sujeitos aos gates indicados abaixo.

Ao concluir cada tarefa, executar e registrar os testes/gates correspondentes. Não criar commits intermediários nem executar `git add`; o usuário fará os commits ao final de todo o trabalho. Se forem úteis, sugerir mensagens Conventional Commit em português, sem trailer `Co-authored-by`.

## Fase 0: alinhamento e aprovação

### T0.1 Aprovar certificado
- **Requisitos:** REQ-03, REQ-05.
- **Trabalho:** definir fixture de teste com `Instituição de Teste`, `Aluno de Teste`, `Curso de Demonstração`, sem logo e com bloco genérico de assinatura opcional; adicionar “TESTE — SEM VALIDADE OFICIAL” ao PDF.
- **Aceite:** fixture permite testar o fluxo completo em desenvolvimento/staging; credenciais, banco e storage de teste são separados da produção; configuração de produção rejeita placeholders. Logo e dados finais ficam para aprovação antes do deploy produtivo.
- **Validação:** emitir PDF de teste e conferir a marca visível e o bloqueio de placeholders em produção.
- **Status:** valores de teste definidos; materiais reais pendentes apenas para produção.

### T0.2 Confirmar IDs externos
- **Requisitos:** REQ-04.
- **Trabalho:** implementar no adapter inicial Supabase o mapeamento de IDs locais para `externalStudentId`, `courseId`, `deliveryMode` e `classId`. Manter esse mapeamento fora do domínio/API, serializar IDs como strings e não alterar schema.
- **Aceite:** online envia aluno + curso + modalidade; presencial envia aluno + curso + modalidade + turma. O adapter valida a associação turma/curso usando o fluxo existente. Outro sistema com IDs equivalentes pode integrar sem mudança na API.
- **Validação:** revisão do schema e dos fluxos de conclusão.
- **Status:** contrato decidido; validação técnica do mapeamento ocorre nos testes de integração T4.1.

### T0.3 Aprovar retenção e exclusão/anomização
- **Requisitos:** REQ-08, REQ-09.
- **Trabalho:** aplicar a política operacional definida: certificado verificável enquanto necessário, auditoria 5 anos, logs 90 dias e backup PostgreSQL Railway 30 dias. Manter processo controlado para pedidos de exclusão/anomização.
- **Aceite:** prazos documentados e aplicáveis; atualizar se surgir obrigação legal/institucional divergente. Não criar endpoint de exclusão física.
- **Validação:** aprovação registrada pelo responsável competente.
- **Status:** política operacional definida; não bloqueia a especificação.

### T0.4 Confirmar infraestrutura e backups
- **Requisitos:** REQ-09, REQ-10.
- **Trabalho:** configurar backup nativo Railway do PostgreSQL com retenção de 30 dias e documentar a ausência de cópia independente dos PDFs Supabase como risco aceito.
- **Aceite:** procedimento de backup/restore do PostgreSQL documentado; risco de perda de PDFs sem cópia própria registrado.
- **Validação:** restaurar o PostgreSQL em ambiente isolado; verificar acesso normal aos objetos no Supabase.
- **Status:** decisão registrada; configuração e teste continuam como tarefas operacionais.

### T0.5 Aprovar baseline das specs
- **Requisitos:** todos.
- **Trabalho:** revisar Requirements, Design e Tasks com negócio, Supabase, jurídico e infraestrutura; resolver comentários e aprovar checkpoint.
- **Aceite:** três documentos aprovados e gates de negócio/risco registrados.
- **Validação:** aceite formal dos responsáveis.
- **Status:** checkpoint aprovado pelo usuário para implementação local; gates de produção permanecem pendentes.

## Fase 1: fundação (após aprovação)

### T1.1 Aplicação NestJS
- **Requisitos:** REQ-10.
- **Trabalho:** estrutura modular, config segura, `/v1`, health/readiness, `@nestjs/swagger` para OpenAPI/Swagger UI, `class-validator`/`class-transformer` nos DTOs, Docker Compose local com PostgreSQL/S3Mock, `.env.example`, seed local e instruções README.
- **Aceite/testes:** sem Railway/Supabase/secrets de nuvem, Docker Compose sobe dependências e a API conecta; documento OpenAPI gerado; build reproduzível; lint, typecheck, testes iniciais e build passam.
- **Status:** concluída localmente; PostgreSQL/S3Mock subidos, migration aplicada, health/readiness e Swagger verificados.

### T1.2 PostgreSQL/migrations
- **Requisitos:** REQ-04 a REQ-06, REQ-08, REQ-09.
- **Trabalho:** Prisma restrito ao adapter de persistência; migrations para credenciais, nonce, rate-limit buckets, idempotência, séries/certificados, contador anual e auditoria; SQL customizado para `CHECK` modalidade/turma e índices únicos parciais `PROCESSING`/`ISSUED`.
- **Aceite/testes:** migrations limpas; PostgreSQL via Testcontainers confirma unicidade de `identityKey`, CHECK online/presencial, um processing e um issued por série e incremento atômico dos buckets sob concorrência.
- **Status:** schema/migration aplicados; teste de concorrência de índice único, CHECK e token bucket existe e roda com `RUN_DB_INTEGRATION=1`.

### T1.3 HMAC, escopos e rotação
- **Requisitos:** REQ-01, REQ-02.
- **Trabalho:** implementar canonicalização `cert-api-hmac-v1`, segredo protegido, janela ±300s, nonce de 16 bytes com TTL ≥10 minutos e reserva atômica, escopos e rotação; rotas privadas sem query string.
- **Aceite/testes:** vetores HMAC compartilhados pelo adapter/API; corpo bruto e vazio; alteração de `X-Client-Id` invalida assinatura; timestamp dentro/fora da janela; replay sequencial/paralelo; escopo insuficiente; rotação; comparação constante e logs sem segredo/assinatura.
- **Status:** canonicalizador, proteção AES-GCM, guard, nonce e escopos implementados. O fluxo local assinado cobre emissão, consulta, download, revogação e reemissão.

## Fase 2: domínio, emissão e storage

### T2.1 Domínio de certificado/série
- **Requisitos:** REQ-03 a REQ-06.
- **Trabalho:** snapshot, código, registro anual, estados, revogação/substituição.
- **Aceite/testes:** invariantes e transições; no máximo um vigente por série; testes unit/property.
- **Status:** identidade, estados e transições de revogação/substituição implementados no repositório; a constraint impede dois vigentes.

### T2.2 Emissão idempotente
- **Requisitos:** REQ-03, REQ-04, REQ-05, REQ-09.
- **Trabalho:** validar `externalStudentId`, `courseId`, `deliveryMode` e `classId` condicional; derivar a identidade canônica aluno+oferta; reservar chave idempotente, snapshot, renderer, upload, finalização e compensação.
- **Aceite/testes:** online sem `classId` e presencial com `classId` válidos; presencial sem turma e online com turma rejeitados; retry não duplica; payload divergente conflita; falhas recuperáveis; sem transação longa.
- **Status:** DTO, identidade e caso de uso/repositório implementados; integração local com PostgreSQL/S3Mock passou para emissão, download e verificação.

### T2.3 Template e renderer
- **Requisitos:** REQ-03, REQ-05.
- **Trabalho:** implementar template aprovado e Playwright com fontes/assets locais, escaping e rede externa bloqueada.
- **Aceite/testes:** fixture sintética e marca “TESTE — SEM VALIDADE OFICIAL” corretas em Chromium; dados longos; SSRF bloqueado; configuração produtiva rejeita placeholders.
- **Status:** renderer Playwright implementado; teste unitário gera PDF local válido.

### T2.4 Adapter Supabase S3
- **Requisitos:** REQ-06, REQ-09.
- **Trabalho:** implementar porta/adapter S3 compatível para S3Mock local e Supabase Storage em produção; upload imutável, hash e URL pré-assinada.
abase real em staging; nenhum credential de produção no ambiente local.
- **Status:** upload/download local pelo S3Mock validado via emissão; teste de assinatura/expiração de URLs e Supabase real ficam para staging.
- **Status:** upload/download local via emissão validados; assinatura/expiração da URL e Supabase real ficam para staging, pois S3Mock não valida esses aspectos.

### T2.5 Consulta, download e revogação
- **Requisitos:** REQ-02, REQ-06, REQ-08.
- **Trabalho:** rotas, escopos, URL de curta duração, motivo, ator, auditoria e enforcement pelo `RateLimitPort` com contadores compartilhados PostgreSQL.
- **Aceite/testes:** E2E de autorização, privacidade, histórico e status/códigos RFC 9457; testar quotas por integração/IP, headers `RateLimit-*`, `Retry-After`, 429 e indisponibilidade 503.
- **Status:** consulta, download, revogação, auditoria, problem+json e rate limit PostgreSQL implementados. A indisponibilidade do banco fecha o limite em 503.

### T2.6 Reemissão corretiva
- **Requisitos:** REQ-04, REQ-06, REQ-08.
- **Trabalho:** motivo, nova chave, vínculo e substituição transacional só após sucesso.
- **Status:** reemissão explícita implementada; falha marca somente o novo certificado como `FAILED` e o anterior permanece vigente.
- **Aceite/testes:** falha mantém anterior vigente; sucesso deixa um vigente; concorrência/retry não duplica.

## Fase 3: endpoints públicos

### T3.1 Verificação pública
- **Requisitos:** REQ-05, REQ-07.e rate limit por IP implementados
- **Aceite/testes:** somente campos públicos aprovados; códigos válidos/inválidos/revogados; enumeração e rate limit.
- **Status:** rota/use case/repositório implementados; testes com PostgreSQL aguardam ambiente de integração.

### T3.2 `file-check`
- **Requisitos:** REQ-07, REQ-08.
- **Status:** implementado em streaming, sem persistir o upload.
- **Aceite/testes:** comparação hash sem persistir upload; PDF até 10 MiB, rejeição acima do limite, deadline total 120s, timeout de inatividade 15s, processamento até 15s após upload, PDFs inválidos, rate limit de 10/minuto por IP e `Retry-After`.

## Fase 4: integração e produção

### T4.1 OpenAPI/Edge Function
- **Requisitos:** REQ-01 a REQ-10.
- **Status:** contrato e fluxo local da API implementados. O adapter do consumidor permanece fora deste repositório, por decisão explícita de não alterar o sistema existente.
- **Aceite/testes:** contrato OpenAPI independente do consumidor; fluxo E2E local emite fixture, consulta estado, baixa PDF do S3Mock e verifica status; adapter Supabase mapeia IDs e assina payload; segredo nunca no navegador; admin validado pelo consumidor; nenhuma migration exigida. Outro CRM/LMS pode implementar o mesmo contrato. Teste de expiração/assinatura da URL fica no staging real.

### T4.2 Carga e decisão sync/async
- **Requisitos:** REQ-09, REQ-10.
- **Aceite/testes:** medir até 10 req/s com perfil confirmado; síncrono só com folga no timeout, caso contrário 202/status.

### T4.3 Backups e restauração
- **Requisitos:** REQ-08, REQ-09.
- **Trabalho:** verificar backup nativo Railway do PostgreSQL com retenção de 30 dias; não criar cópia independente dos PDFs Supabase, conforme risco aceito.
- **Aceite/testes:** restaurar PostgreSQL em ambiente isolado, medir RPO/RTO e documentar que PDFs não têm cópia independente.

### T4.4 Gate de produção
- **Requisitos:** todos.
- **Aceite:** staging ponta a ponta com placeholders claramente marcados, política operacional de retenção registrada, restore PostgreSQL testado, alertas/runbook e testes aprovados. O gestor aprova dados reais, logo e assinatura antes do deploy produtivo; o risco de não haver backup independente dos PDFs fica documentado e aceito.
