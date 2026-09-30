# Requirements: API de Emissão de Certificados

**Status:** Baseline aprovada pelo usuário para iniciar implementação e testes locais em 2026-09-29. Aprovações e evidências necessárias para produção continuam pendentes.

## Objetivo

Especificar serviço independente para emitir, consultar, baixar, revogar, reemitir corretivamente e verificar certificados de cursos. Qualquer sistema consumidor com alunos/ofertas e confirmação de conclusão pode integrar; cada consumidor permanece fonte de verdade desses dados. Supabase é somente o primeiro adapter planejado.

Este é o escopo do projeto completo, não um MVP nem piloto. O usuário autorizou iniciar a fundação e o fluxo local com dados fictícios; mudanças de escopo devem atualizar estas specs antes de ampliar a implementação.

## Atores

- **Sistema consumidor:** backend ou adapter servidor de qualquer CRM/LMS/plataforma de cursos, autenticado como máquina.
- **Administrador do consumidor:** pessoa cuja permissão é verificada pelo sistema consumidor antes de solicitar ações administrativas.
- **Pessoa verificadora:** consulta o estado público por código/QR.
- **Operação:** administra credenciais, infraestrutura, observabilidade e recuperação.

## Requisitos

### REQ-01 Autenticação de máquina

- Toda rota privada exige TLS, `client_id`, timestamp, nonce, assinatura HMAC-SHA256 e escopo suficiente.
- Assinatura inválida, timestamp fora da janela ou nonce repetido são rejeitados antes da operação.
- JWT comum de aluno nunca autoriza emissão.
- Segredos são protegidos e nunca aparecem em logs, respostas ou dados em texto puro.

### REQ-02 Escopos e ator

- Escopos `issue`, `read` e `revoke` são separados por credencial.
- O adapter do consumidor valida o papel de administrador segundo o provedor de identidade local antes de revogar/reemitir.
- A API registra o identificador do ator enviado pelo consumidor e coberto pela assinatura, sem depender de Supabase ou de um provedor de identidade específico.

### REQ-03 Emissão e snapshot

- O consumidor envia nome do aluno, `externalStudentId`, `courseId`, `deliveryMode` (`online` ou `in_person`), `classId` quando presencial, título da oferta, carga horária, data de conclusão, responsável opcional e tipo permitido.
- A instituição é definida na API; a API não mantém cadastro de cursos nem solicita CPF.
- Presencial e online usam o mesmo template visual, mas são ofertas distintas. O adapter de cada consumidor mapeia os IDs locais para o contrato; a API não depende de CRM/Supabase nem exige que o consumidor adote um schema específico.
- O snapshot congela os dados e versão de template usados; mudanças futuras no sistema consumidor não alteram certificado emitido.
- Iniciar com um tipo de certificado para todas as ofertas; tipos específicos por curso poderão ser acrescentados mediante aprovação.
- Em desenvolvimento/staging, permitir placeholders fictícios e inserir no PDF “TESTE — SEM VALIDADE OFICIAL”; logo oficial não é necessária para validar o fluxo.
- Conteúdo e identidade visual definitivos são requisito de produção, não de desenvolvimento/teste, e devem ser aprovados pelo gestor antes do deploy produtivo.

### REQ-04 Referência e idempotência

- Toda mutação exige `Idempotency-Key` associada à credencial.
- `externalStudentId`, `courseId` e `classId` são strings opacas sem PII; `externalStudentId` identifica a pessoa, nunca uma compra/transação.
- A integração mapeia IDs que já existem em seu sistema; a API não exige novas tabelas ou migrations no consumidor.
- Mesma chave e mesmo conteúdo retornam o resultado/estado já existente; mesma chave e conteúdo diferente resultam em conflito.
- A identidade lógica inclui o namespace estável da integração e `(externalStudentId, deliveryMode, courseId)` para online ou `(externalStudentId, deliveryMode, courseId, classId)` para presencial.
- O namespace pertence à integração lógica, não à versão do segredo; rotação de credencial não cria nova identidade. Integrações diferentes só deduplicam a mesma pessoa/oferta se enviarem IDs canônicos compartilhados.
- `classId` é obrigatório quando `deliveryMode` é `in_person` e deve ser omitido quando `deliveryMode` é `online`; `courseId` é obrigatório em ambos os modos.
- Mesma identidade de aluno+oferta e mesmo conteúdo retorna o certificado existente; conteúdo diferente gera conflito e exige reemissão explícita.
- O namespace estável identifica a integração que originou os IDs. A API trata IDs como opacos e não consulta o catálogo do consumidor; o adapter é responsável por garantir a relação entre curso e turma. Rotacionar segredo não cria novo namespace. Se vários sistemas precisarem deduplicar a mesma pessoa/oferta, devem enviar IDs canônicos compartilhados.
- Deve haver no máximo um certificado vigente por identidade aluno+oferta definida acima. `Idempotency-Key` continua sendo distinta e serve somente para retry da operação HTTP.

### REQ-05 Registro e documento

- Código de verificação aleatório via CSPRNG com pelo menos 128 bits e unicidade garantida pelo PostgreSQL.
- Número sequencial por instituição/ano, por exemplo `2026-000123`; lacunas são permitidas e números não são reutilizados.
- Snapshot, versão de template, chave privada do objeto, SHA-256 e metadados necessários são registrados.
- Código/QR consulta a fonte oficial online. Não afirmar que código ou hash torna PDF impossível de falsificar; ICP-Brasil está fora do escopo.

### REQ-06 Consulta, download, revogação e reemissão

- Leitura autenticada retorna somente metadados autorizados.
- Download autenticado retorna URL pré-assinada curta; o bucket é privado.
- Revogação exige escopo, motivo e ator informado; mantém histórico e não apaga fisicamente o certificado.
- Segunda via é novo download do mesmo arquivo, código e registro.
- Reemissão corretiva é explícita, com motivo e vínculo ao anterior. O anterior permanece vigente se a nova emissão falhar; após sucesso, a atualização deve garantir atomicamente um único certificado vigente.

### REQ-07 Verificação pública

- Consulta pública retorna somente status, nome, título da oferta e instituição.
- Respostas reduzem enumeração e não expõem PDF, IDs externos ou auditoria.
- `file-check` compara SHA-256 sem guardar o upload, com limites de tamanho, timeout e frequência definidos no Design.

### REQ-08 Privacidade e auditoria

- Auditoria registra ator de integração, ator informado quando aplicável, evento, resultado, timestamp UTC, request ID e referência externa.
- Logs técnicos são separados e não registram segredos, CPF ou payload completo.
- Não há endpoint de exclusão de certificado. Pedidos de exclusão/anomização seguem processo controlado.
- Aplicar a política de retenção operacional do projeto: certificado/registro enquanto precisar ser verificável; auditoria por 5 anos; logs técnicos por 90 dias; backup nativo PostgreSQL Railway por 30 dias. Esses prazos não constituem parecer jurídico e podem ser atualizados se surgir obrigação legal/institucional diferente.

### REQ-09 Resiliência e operação

- Estados incluem `PROCESSING`, `ISSUED` e `FAILED`; retries são idempotentes.
- Falhas de renderer/storage geram estado auditável e permitem reconciliação de emissão presa/objeto órfão.
- Nenhuma transação PostgreSQL permanece aberta durante renderização ou upload.
- Iniciar síncrono apenas se medições mostrarem folga nos limites do primeiro consumidor integrado; caso contrário usar `202 Accepted` e consulta de estado.
- Metas provisórias internas: disponibilidade 99,5% mensal, RTO até 24h, RPO até 24h e pico de 10 req/s; validar por infraestrutura e testes, sem tratá-las como SLA contratual.
- Usar backup nativo Railway para PostgreSQL, com retenção de 30 dias, e testar restauração antes da produção. Não haverá cópia independente dos PDFs no Supabase; essa ausência é um risco operacional aceito e deve estar documentada. O backup Railway não cobre PDFs.

### REQ-10 Contrato e qualidade

- OpenAPI versionado sob `/v1`, validação estrita de DTOs, limites e erros estáveis.
- Gates de release: lint, typecheck, testes unitários/property/e2e, integrações aplicáveis e build.

### REQ-11 Ambientes de teste

- Ambientes não produtivos usam nomes/IDs sintéticos e PDFs com marca visível “TESTE — SEM VALIDADE OFICIAL”.
- Credenciais, banco e bucket de teste são separados dos recursos produtivos.
- THE SYSTEM SHALL permitir execução local com PostgreSQL e emulador S3 via Docker Compose, renderer Chromium local e configuração de desenvolvimento, sem Railway/Supabase nem credenciais de nuvem.
- A documentação local SHALL permitir iniciar dependências e API, emitir certificado de teste, consultar, baixar e verificar o PDF usando fixture sintética.
- THE SYSTEM SHALL impedir que placeholders de teste sejam usados para emitir documentos apresentados como oficiais em produção.

### REQ-12 Canonicalização, limites e erros HTTP

- Rotas privadas v1 não aceitam query string; a assinatura HMAC-SHA256 inclui `X-Client-Id`, método/path, timestamp, nonce, `Idempotency-Key` canônica quando aplicável e hash do corpo bruto conforme a string definida no Design.
- Nonce contém 16 bytes CSPRNG em base64url; timestamp tem tolerância de ±300 segundos; `Idempotency-Key` é UUID canônica lowercase.
- Nonces são únicos por integração, reservados atomicamente e mantidos por pelo menos 10 minutos; replay retorna `401 AUTHENTICATION_FAILED`.
- JSON é limitado a 64 KiB. IDs externos aceitam 1–128 caracteres UTF-8; nome do aluno até 200, título até 300, responsável até 200 e cargo até 100; carga horária é inteiro de 1–10.000; data é `YYYY-MM-DD`; motivo de revogação até 1.000 caracteres.
- `file-check` aceita PDF até 10 MiB em streaming, sem persistir o arquivo; deadline total de 120 segundos, timeout de inatividade de 15 segundos durante recebimento e até 15 segundos de processamento após upload completo.
- Limites iniciais: privado 600 requisições/minuto por integração, burst 30; mutações de emissão/reemissão/revogação 60/minuto, burst 5; verificação pública 120/minuto por IP, burst 30; `file-check` 10/minuto por IP, burst 2.
- Limites são aplicados com estado atômico compartilhado entre instâncias; IP encaminhado só é confiável atrás de proxy configurado.
- Respostas de erro usam `application/problem+json`, código estável e request ID: 400 validação/pedido malformado; 401 autenticação/assinatura/replay; 403 escopo; 404 recurso; 409 conflito de idempotência/certificado/estado; 413 payload excedido; 415 media type; 422 transição/tipo inválido; 429 rate limit; 500 interno; 503 dependência indisponível. `429` inclui `Retry-After` e headers `RateLimit-*`; respostas públicas não permitem enumerar códigos.

## Fora do escopo

Cadastro/gestão de alunos ou cursos pela API; CPF; HTML/CSS enviado pelo consumidor; JWT de aluno para emissão; ICP-Brasil; alegação de infalsificabilidade; microserviços internos, CQRS completo, Redis ou event bus sem necessidade aprovada.

## Gates de alinhamento

1. Produção: gestor aprova tipos, texto, conteúdo real, assinatura e identidade visual antes do deploy produtivo. Placeholders com marca de teste bastam para desenvolvimento/staging.
2. Integração inicial: validar que o adapter Supabase mapeia seus IDs para o contrato genérico; outros sistemas podem integrar com adapters próprios, sem alteração do domínio/API.
3. Retenção: aplicar a política operacional registrada e atualizá-la se houver obrigação legal/institucional divergente; tratar pedidos de exclusão/anomização pelo processo controlado.
4. Infraestrutura: configurar o backup nativo Railway do PostgreSQL por 30 dias e testar restore. Ausência de cópia independente dos PDFs é risco aceito; o backup Railway não cobre esses arquivos.

## Pontos para o Design

Canonicalização HMAC, janela/TTL de nonce, escopo/expiração idempotente, DTOs e limites, erros HTTP, rate limits, operação de credenciais, backup de PDFs e critério síncrono/assíncrono.
