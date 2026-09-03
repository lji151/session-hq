# Recipe: push HQ events to a chat

Send yourself a message when something in the HQ changes — a decision recorded, a deadline
approaching, a long batch finishing. Written for Telegram because its bot API needs no
infrastructure, but the shape transfers to Slack, Discord, ntfy, or email.

## Why bother

A status file is pull. Some events need push: a subscription renewing tomorrow, a nightly job
that failed, a session that recorded a decision you should know about before your next meeting.

Push to a **chat**, not a desktop notification. A toast is gone in five seconds and only exists on
the machine that produced it. A chat message waits on your phone.

## The one rule: the token is not in the script

A bot token is a bearer credential. Anyone holding it can post as your bot, read what it receives,
and enumerate its chats.

- Store it in an environment variable, or in a file with restricted permissions outside any repo.
- Never commit it, never log it, never put it in a status file or a memory file.
- Mask it in any output you print. A token that reaches a log has to be treated as leaked.
- If you version your notifier script, add a check that fails if the token appears in the source.

The same goes for the chat id, which is less sensitive but still identifies you.

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${TELEGRAM_BOT_TOKEN:?set TELEGRAM_BOT_TOKEN in the environment, never in this file}"
: "${TELEGRAM_CHAT_ID:?set TELEGRAM_CHAT_ID in the environment}"

text="${1:?usage: notify.sh \"message\"}"

curl -sS --fail-with-body \
  --max-time 20 \
  -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "disable_web_page_preview=true" \
  --data-urlencode "text=${text}" \
  > /dev/null

echo "notified"
```

`--data-urlencode` matters: message text routinely contains `&`, `=`, and newlines.

## Node (built-ins only, matching the rest of this plugin)

```js
#!/usr/bin/env node
// notify.mjs — usage: node notify.mjs "message"
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
  console.error('set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment');
  process.exit(1);
}

const text = process.argv.slice(2).join(' ').trim();
if (!text) { console.error('usage: node notify.mjs "message"'); process.exit(1); }

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  signal: AbortSignal.timeout(20_000),
});

if (!res.ok) {
  // Print the status, never the URL — the URL contains the token.
  console.error(`notify failed: HTTP ${res.status}`);
  process.exit(1);
}
console.log('notified');
```

## PowerShell

```powershell
param([Parameter(Mandatory)][string]$Text)

$token  = $env:TELEGRAM_BOT_TOKEN
$chatId = $env:TELEGRAM_CHAT_ID
if (-not $token -or -not $chatId) { throw 'set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID' }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = @{ chat_id = $chatId; text = $Text; disable_web_page_preview = $true }

try {
  Invoke-RestMethod -Method Post -TimeoutSec 20 `
    -Uri "https://api.telegram.org/bot$token/sendMessage" `
    -Body $body | Out-Null
  'notified'
} catch {
  # $_.Exception.Message can contain the request URI, and the URI contains the token.
  throw "notify failed: $($_.Exception.Response.StatusCode)"
}
```

## Wiring it to the HQ

**From a slash command.** Simplest and most controllable — the session decides what is worth
sending, and you never get notified about routine work.

**From a Stop hook.** Add a second hook alongside the plugin's, and notify only on an actual
change. Note that hooks on the same event run in parallel and cannot see each other's output.

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/../notify-on-change.sh\"", "timeout": 25 }] }
    ]
  }
}
```

**From a scheduled sweep.** Read the HQ status files on a schedule and notify only when something
crosses a threshold — a domain gone stale past its window, a `Blocked on` line naming the user.
This is usually the highest signal-to-noise option.

## Keeping it quiet enough to survive

A notifier that fires on everything gets muted within a week, and a muted notifier is worse than
none because you still believe you are covered.

- Notify on **state changes**, not on activity.
- Deduplicate: keep the last message's hash in a small state file and skip identical repeats.
- Rate-limit: a floor of minutes between messages, enforced in the script.
- Give every recurring series an off switch — a flag file the script checks first and exits on.
  When the thing is done, one `touch` silences the whole series.

## Failure modes worth handling

- **No network.** Fail quietly and retry later; never block a session on a notification.
- **Bad token.** The API returns 401. Do not retry in a loop; that looks like an attack.
- **Long messages.** Telegram caps message text; chunk or truncate rather than losing the send.
- **Formatting modes.** If you enable Markdown or HTML parse modes, unescaped user text will
  produce 400s. Plain text is the reliable default.
