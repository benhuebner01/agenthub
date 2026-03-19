# AgentHub

AI Agent Orchestration Platform — a self-hosted alternative to Paperclip AI. Manage, schedule, and monitor HTTP, Claude, OpenAI, and Bash agents from a single dashboard.

**No PostgreSQL. No Redis. Just Node.js + SQLite.**
Data is stored in `./data/agenthub.db` (auto-created).

---

## Deployment

### Option 1: VPS (Recommended — no Docker needed)
```bash
git clone https://github.com/benhuebner01/agenthub.git
cd agenthub
cp .env.example .env   # edit with your API keys
chmod +x deploy.sh
./deploy.sh            # installs, builds, starts with PM2
```
Dashboard: http://your-server-ip:3000

### Option 2: Docker (single container, no dependencies)
```bash
cp .env.example .env   # edit first
docker-compose up -d
```
Dashboard: http://localhost:3000

### Option 3: Local Development
```bash
npm install && cd client && npm install && cd ..
npm run migrate
npm run dev:all        # API on :3000, Vite on :5173
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP server port (default: 3000) |
| `NODE_ENV` | No | `development` or `production` |
| `DATA_DIR` | No | Directory for SQLite DB (default: `./data`) |
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
│                       (runs agents)  (node-cron)     │
│                            │             │           │
│                       Budget        Telegram Bot     │
│                       Tracker       (grammy)         │
│                            │                         │
│                       SQLite (Drizzle ORM)          │
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
- **Drizzle ORM** for type-safe SQLite queries
- **better-sqlite3** for fast embedded database
- **node-cron** for cron-based job scheduling
- **grammy** for the Telegram bot
- **Zod** for request validation
- **Express** for the REST API
