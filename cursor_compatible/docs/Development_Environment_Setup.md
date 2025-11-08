# Noderr Development Environment Setup

This guide outlines the standard development environment setup for the Noderr protocol.

## Prerequisites

- Node.js v20.x
- Docker & Docker Compose
- Git
- PostgreSQL 14 (for local development without Docker)
- Rust toolchain (for native modules)

## Getting Started

1. **Clone the repository**

```bash
git clone https://github.com/your-org/noderr.git
cd noderr
```

2. **Install dependencies**

```bash
npm install
```

3. **Environment setup**

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your local configuration.

4. **Database setup**

Using Docker (recommended):
```bash
docker-compose up -d postgres
```

Or connect to your local PostgreSQL instance by updating the `.env` file.

5. **Run migrations**

```bash
npm run migrate
```

## Development Workflow

1. **Start the development server**

```bash
npm run dev
```

2. **Run tests**

```bash
npm test                   # Run all tests
npm run test:adaptive      # Run adaptive strategy tests
npm run test:regime        # Run regime classification tests
npm run test:adapters      # Run adapter tests
```

3. **Linting and formatting**

```bash
npm run lint               # Check code style
npm run lint:fix           # Fix code style issues
```

4. **Building the project**

```bash
npm run build              # Build TypeScript
npm run build:all          # Build TS and Rust components
```

## Docker Development

To run the entire stack locally:

```bash
docker-compose up -d
```

## Metrics & Monitoring

Start the metrics stack:

```bash
npm run metrics:start
```

Access Grafana at http://localhost:3001 (default credentials: admin/admin)

## Conventions

- **Branching**: Use `feature/`, `bugfix/`, `hotfix/` prefixes
- **Commits**: Follow [Conventional Commits](https://www.conventionalcommits.org/)
- **Pull Requests**: Include tests and documentation updates 