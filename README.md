# API de Certificados

Serviço independente para emitir e verificar certificados. A API aceita adapters de diferentes CRMs/LMS; Supabase é o primeiro consumidor planejado.

## Estado atual

A fundação NestJS responde em `/v1/health`; readiness verifica PostgreSQL em `/v1/health/ready`; Swagger UI está em `/docs`. Emissão, consulta privada, download por URL pré-assinada, revogação, reemissão corretiva, verificação pública e `file-check` estão implementados. O script local emite, baixa e verifica um PDF quando PostgreSQL e S3Mock estiverem ativos. Backup Railway, teste de carga e gate de produção continuam pendentes.

## Pré-requisitos

- Node.js 22 ou superior
- npm
- Docker Desktop com Docker Compose, aberto e com o Engine em estado `Running`

## Ambiente local

Na raiz do projeto, copie `.env.example` para `.env` e inicie PostgreSQL e S3Mock:

```powershell
Copy-Item .env.example .env
 docker compose up -d
Copy-Item apps/api/.env.example apps/api/.env
Push-Location apps/api
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run start:dev
```

Em outro terminal, a partir de `apps/api`, enviar uma emissão assinada com dados fictícios e baixar o PDF de teste:

```powershell
npm run issue:test
```

O script consulta também o código de verificação público. O PDF é gravado em `generated/` com a marca “TESTE — SEM VALIDADE OFICIAL”. Essa pasta é ignorada pelo Git.

Para parar os serviços locais, da raiz do projeto:

```powershell
docker compose down
```

Use `docker compose down -v` somente se quiser apagar os volumes locais do PostgreSQL e S3Mock.

A API fica em `http://localhost:3000`; health check em `http://localhost:3000/v1/health`; Swagger UI em `http://localhost:3000/docs`. S3Mock disponibiliza o endpoint S3 local em `http://localhost:9000`.

S3Mock é um emulador de desenvolvimento. Ele permite testar upload/download, mas aceita URLs pré-assinadas sem validar assinatura nem expiração; validar essas proteções em staging com o storage de produção.

As credenciais dos exemplos são exclusivamente locais. Não as use em Railway, Supabase ou produção. O modo local não precisa de credenciais nem acesso à nuvem.
