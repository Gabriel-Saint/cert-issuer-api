# API de Certificados

Serviço independente para emissão, consulta e verificação de certificados de conclusão de curso. Desacoplado de qualquer CRM ou LMS — qualquer sistema que implemente o protocolo de autenticação pode integrar.

## O que faz

- Emite certificados em PDF (renderizados via Playwright/Chromium)
- Armazena PDFs em S3 (ou S3-compatível)
- Mantém histórico de estados: `PROCESSING → ISSUED → REVOKED / SUPERSEDED`
- Endpoints privados (machine-to-machine via HMAC) para emitir, consultar, baixar, revogar e reemitir
- Endpoints públicos para verificação por código e comparação de hash de arquivo

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | NestJS 11 + TypeScript 5 |
| Banco de dados | PostgreSQL 16 + Prisma 6 |
| PDF | Playwright (Chromium headless) + QRCode |
| Storage | AWS S3 SDK v3 (S3Mock em desenvolvimento) |
| Autenticação | HMAC-SHA256 customizado (`cert-api-hmac-v1`) |
| Documentação | Swagger UI (`/docs`) |

## Pré-requisitos

- Node.js 22+
- npm
- Docker Desktop rodando

## Rodar localmente

```powershell
# 1. Variáveis de ambiente
Copy-Item .env.example .env

# 2. Sobe PostgreSQL e S3Mock
docker compose up -d

# 3. Dependências
npm install

# 4. Gera Prisma Client e aplica migrations
npm run db:generate
npm run db:migrate

# 5. Seed (cria Integration e cliente local)
npm run db:seed

# 6. Instala Chromium para o renderer de PDF
npx playwright install chromium

# 7. Inicia a API em modo watch
npm run start:dev
```

A API sobe em `http://localhost:3000`.

## URLs locais

| Recurso | URL |
|---|---|
| Health | http://localhost:3000/v1/health |
| Readiness | http://localhost:3000/v1/health/ready |
| Swagger UI | http://localhost:3000/docs |
| S3Mock | http://localhost:9000 |

## Testar via terminal

Em outro terminal, na raiz do projeto:

```powershell
# Emite um certificado e exibe o resultado
npx ts-node --require dotenv/config scripts/test-api.ts emitir

# Consulta por ID (use o certificateId retornado acima)
npx ts-node --require dotenv/config scripts/test-api.ts consultar <certificateId>

# Gera URL de download do PDF
npx ts-node --require dotenv/config scripts/test-api.ts download <certificateId>

# Verificação pública por código
npx ts-node --require dotenv/config scripts/test-api.ts verificar <verificationCode>

# Revoga um certificado
npx ts-node --require dotenv/config scripts/test-api.ts revogar <certificateId>
```

### Fluxo completo automatizado

```powershell
# Emite → consulta → baixa → reemite → revoga em sequência
npx ts-node --require dotenv/config scripts/exercise-certificate-flow.local.ts
```

## Testes

```powershell
# Testes unitários
npm test -- --forceExit

# Testes de integração (requer banco rodando)
$env:RUN_DB_INTEGRATION=1; npm test -- --forceExit
```

## Estrutura do projeto

```
src/
├── main.ts                          # Bootstrap NestJS
├── app.module.ts
├── infrastructure/persistence/      # PrismaService
├── shared/presentation/             # Problem Details (RFC 9457), middlewares
└── modules/
    ├── machine-auth/                # Autenticação HMAC M2M
    ├── rate-limit/                  # Token bucket no PostgreSQL
    └── certificates/
        ├── domain/                  # Entidades e value objects
        ├── application/
        │   ├── ports/               # Interfaces (contratos)
        │   ├── errors/              # Erros de domínio tipados
        │   └── use-cases/           # Lógica de negócio
        ├── infrastructure/          # Prisma, Playwright, S3
        └── presentation/            # Controllers, DTOs, mappers
prisma/
├── schema.prisma
├── migrations/
└── seed.ts
scripts/                             # Scripts de teste local
docs/specs/                          # Requisitos, design e tasks
```

## Parar os serviços

```powershell
docker compose down
```

Use `docker compose down -v` para apagar os volumes (banco e S3Mock).

## Observações

- As credenciais do `.env.example` são exclusivamente para desenvolvimento local
- S3Mock aceita URLs pré-assinadas sem validar assinatura — use Supabase Storage em staging para testar esse comportamento
- PDFs gerados localmente ficam em `generated/` (ignorado pelo Git)
- Em ambiente não-produção o PDF recebe marca d'água "TESTE — SEM VALIDADE OFICIAL"
