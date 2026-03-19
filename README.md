# ⚡ AgentHub

AI Agent Orchestration Platform — a self-hosted alternative to Paperclip AI. Manage, schedule, and monitor HTTP, Claude, OpenAI, and Bash agents from a single dashboard.

---

## Quick Start (Docker)

```bash
# 1. Clone and copy env
cp .env.example .env
# Edit .env with your API keys

# 2. Start everything
docker-compose up --build

# 3. Open dashboard
open http://localhost:3000
```

---

## Manual Install

```bash
# Prerequisites: Node 20+, PostgreSQL 16, Redis 7

npm install

# Set up environment
cp .env.example .env
# Edit DATABASE_URL and REDIS_URL in .env

# Run database migrations
npm run migrate

# Start development server
npm run dev

# Or build and run production
npm run build && npm start
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `PORT` | No | HTTP server port (default: 3000) |
| `NODE_ENV` | No | `development` or `production` |
| `API_SECRET` | No | X-API-Key header value for mutation endpoints |
| `TELEGRAM_BOT_TOKEN` | No | BotFather token to enable Telegram bot |
| `TELEGRAM_AUTHORIZED_USERS` | No | Comma-separated Telegram user IDs |
| `ANTHROPIC_API_KEY` | No | Required for Claude-type agents |
| `OPENAI_API_KEY` | No | Required for OpenAI-type agents |

---

## API Endpoints

### Agents
| Method | Path | Description |
|---|---|---|
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:id` | Get single agent |
| POST | `/api/agents` | Create agent |
| PUT | `/api/agents/:id` | Update agent |
| DELETE | `/api/agents/:id` | Delete agent |
| POST | `/api/agents/:id/run` | Trigger manual run |
| GET | `/api/agents/:id/runs` | Get run history |

### Schedules
| Method | Path | Description |
|---|---|---|
| GET | `/api/schedules` | List all schedules |
| POST | `/api/schedules` | Create schedule |
| PUT | `/api/schedules/:id` | Update schedule |
| DELETE | `/api/schedules/:id` | Delete schedule |
| POST | `/api/schedules/:id/enable` | Enable schedule |
| POST | `/api/schedules/:id/disable` | Disable schedule |

### Runs
| Method | Path | Description |
|---|---|---|
| GET | `/api/runs` | List runs (supports `?agentId=`, `?status=`, `?limit=`, `?offset=`) |
| GET | `/api/runs/:id` | Get run with tool calls |
| DELETE | `/api/runs/:id` | Cancel pending/running run |
| GET | `/api/runs/:id/logs` | Get audit logs for run |

### Budgets
| Method | Path | Description |
|---|---|---|
| GET | `/api/budgets` | List all budgets |
| GET | `/api/budgets/:agentId` | Get budget for agent |
| POST | `/api/budgets` | Create/update budget |
| DELETE | `/api/budgets/:id` | Delete budget |
| POST | `/api/budgets/:agentId/reset` | Reset spend to $0 |

### System
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |

---

## Telegram Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message, shows your Telegram ID |
| `/agents` | List all agents with status |
| `/run <name> [input]` | Trigger an agent manually |
| `/status [agent]` | Show agent status and recent runs |
| `/budget [agent]` | Show budget usage with progress bar |
| `/logs [agent] [limit]` | Show recent run history |
| `/pause <agent>` | Pause agent and disable its schedules |
| `/resume <agent>` | Resume agent and re-enable schedules |
| `/help` | Show all commands |

To authorize users: add their Telegram ID to `TELEGRAM_AUTHORIZED_USERS` env var, or set `authorized=true` in the `telegram_users` database table.

---

## Agent Types & Config

### HTTP Agent
Sends a POST request to an external endpoint.
```json
{
  "endpoint": "https://your-webhook.example.com/run",
  "headers": { "Authorization": "Bearer TOKEN" },
  "timeout": 30000
}
```

### Claude Agent
Calls Anthropic's Claude API. Requires `ANTHROPIC_API_KEY`.
```json
{
  "model": "claude-3-5-sonnet-20241022",
  "system_prompt": "You are a data analyst. Summarize the input.",
  "max_tokens": 1024,
  "api_key_override": "sk-ant-optional-override"
}
```
Pricing: $3/M input tokens, $15/M output tokens (claude-3-5-sonnet).

### OpenAI Agent
Calls OpenAI's GPT API. Requires `OPENAI_API_KEY`.
```json
{
  "model": "gpt-4o",
  "system_prompt": "You are a helpful assistant.",
  "max_tokens": 1024,
  "api_key_override": "sk-optional-override"
}
```
Pricing: $2.50/M input tokens, $10/M output tokens (gpt-4o).

### Bash Agent
Executes a shell command. Input is passed as environment variables.
```json
{
  "command": "python3 /scripts/my_agent.py",
  "timeout": 30000
}
```
Environment variables available inside the command:
- `$AGENT_INPUT` — full JSON-encoded input
- `$AGENT_INPUT_KEY` — individual input fields as `AGENT_INPUT_<KEY>`

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    AgentHub                         │
│                                                     │
│  Express API ──── Routes ──── Services              │
│       │                           │                 │
│  Static Dashboard          ┌──────┴──────┐          │
│                            │             │           │
│                       Executor      Scheduler        │
│                       (runs agents)  (BullMQ/Redis)  │
│                            │             │           │
│                       Budget        Telegram Bot     │
│                       Tracker       (grammy)         │
│                            │                         │
│                       PostgreSQL (Drizzle ORM)       │
└─────────────────────────────────────────────────────┘
```

---

## Development

```bash
# Watch mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Run migrations
npm run migrate

# Seed example data
npm run seed
```

The project uses:
- **Drizzle ORM** for type-safe PostgreSQL queries
- **BullMQ** for reliable cron-based job scheduling
- **grammy** for the Telegram bot
- **Zod** for request validation
- **Express** for the REST API
