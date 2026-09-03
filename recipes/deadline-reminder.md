# Recipe: deadline reminders that actually fire

A hard deadline — a subscription renewing, a filing date, a trial converting to paid — needs more
than one alarm. This recipe is the shape that survives a laptop being asleep, a notification being
dismissed while distracted, and a scheduler silently stopping after an OS update.

See [case study 1](../docs/case-studies.md) for what it costs when this is missing.

## The shape

Five properties, and each one exists because of a specific way single reminders fail:

1. **Multiple shots.** Several reminders across several days, escalating in urgency. One
   notification arriving at a bad moment is one notification missed.
2. **One completion flag.** A file whose existence silences the entire series. When the thing is
   done, one `touch` and nothing nags you again. Without this you either endure reminders for a
   completed task, or you disable them and lose the ones that remain.
3. **Catch-up.** A run that fires missed shots on next wake. Laptops are asleep at 09:00 more
   often than anyone plans for.
4. **Delivery somewhere you look.** A chat notifier, not a desktop toast — see
   [notifier-telegram.md](notifier-telegram.md). A toast on a sleeping machine never existed.
5. **A standing rule in memory.** The reminders cover *this* deadline. A rule in the memory index
   covers the whole class — see the `feedback-*` example in case study 1.

## The script

Portable core, one file, no dependencies:

```js
#!/usr/bin/env node
// remind.mjs --shot <1..5> [--force]
//
// State lives in two files next to this script:
//   deadline.done.flag   — if present, every shot exits silently
//   remind.state.json    — which shots have already fired (for catch-up)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLAG = path.join(HERE, 'deadline.done.flag');
const STATE = path.join(HERE, 'remind.state.json');

const MESSAGES = {
  1: 'Heads up: the trial converts to paid in 3 days. Cancel or confirm you want it.',
  2: 'Reminder: 2 days until the trial converts to paid.',
  3: 'Tomorrow: the trial converts to paid. Cancel today if you are not keeping it.',
  4: 'Today is the last day before the trial converts to paid.',
  5: 'FINAL: the trial converts to paid within hours.',
};

const shot = Number(process.argv[process.argv.indexOf('--shot') + 1]);
const force = process.argv.includes('--force');
if (!MESSAGES[shot]) { console.error('usage: remind.mjs --shot <1..5>'); process.exit(1); }

// One flag silences the whole series.
if (fs.existsSync(FLAG) && !force) { console.log('done flag present, silent'); process.exit(0); }

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { fired: [] };
if (state.fired.includes(shot) && !force) { console.log(`shot ${shot} already fired`); process.exit(0); }

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) { console.error('notifier not configured'); process.exit(1); }

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text: MESSAGES[shot] }),
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) { console.error(`send failed: HTTP ${res.status}`); process.exit(1); }

state.fired.push(shot);
fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
console.log(`shot ${shot} sent`);
```

Cancel the whole series with one command:

```bash
touch ~/reminders/deadline.done.flag          # POSIX
New-Item ~/reminders/deadline.done.flag       # PowerShell
```

Catch-up is the same script driven by a small wrapper that computes which shots are now due from
today's date and runs each un-fired one. Because `remind.state.json` records what already went
out, catch-up cannot double-send.

## Scheduling

### Windows — Task Scheduler

```powershell
$node   = (Get-Command node).Source
$script = "$HOME\reminders\remind.mjs"

# One task per shot, at a fixed local time
$action  = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" --shot 1"
$trigger = New-ScheduledTaskTrigger -Once -At '2026-03-10T09:00:00'

# StartWhenAvailable is the catch-up: a task missed while asleep runs on next wake
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName 'deadline-shot-1' -Action $action `
  -Trigger $trigger -Settings $settings -Description 'Trial conversion reminder 1/5'
```

Check and clean up:

```powershell
Get-ScheduledTask -TaskName 'deadline-shot-*' | Select TaskName, State
Get-ScheduledTaskInfo -TaskName 'deadline-shot-1' | Select LastRunTime, LastTaskResult
Unregister-ScheduledTask -TaskName 'deadline-shot-*' -Confirm:$false
```

`LastTaskResult` of `0` is success. Non-zero means the script failed — check it after the first
shot rather than assuming the series works.

### Linux — cron

```cron
# m  h  dom mon dow  command
  0  9  10  3   *    /usr/bin/node $HOME/reminders/remind.mjs --shot 1
  0  9  11  3   *    /usr/bin/node $HOME/reminders/remind.mjs --shot 2
  0 18  11  3   *    /usr/bin/node $HOME/reminders/remind.mjs --shot 3

# Catch-up: every login and hourly, fire anything that was due and missed
@reboot              /usr/bin/node $HOME/reminders/catchup.mjs
  5  *  *   *   *    /usr/bin/node $HOME/reminders/catchup.mjs
```

cron has almost no environment. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` at the top of the
crontab, or source a file from a wrapper — and keep that file out of any repo. Use absolute paths
for everything; `$PATH` will not be what your shell has.

`systemd` timers are the better choice if available: `Persistent=true` gives real catch-up, and
`journalctl -u <unit>` gives you logs, which cron does not.

### macOS — launchd

`~/Library/LaunchAgents/com.example.deadline-shot-1.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.deadline-shot-1</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/YOURNAME/reminders/remind.mjs</string>
    <string>--shot</string><string>1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Month</key><integer>3</integer><key>Day</key><integer>10</integer>
        <key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardErrorPath</key><string>/tmp/deadline-shot-1.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.example.deadline-shot-1.plist
launchctl list | grep deadline
launchctl unload ~/Library/LaunchAgents/com.example.deadline-shot-1.plist
```

launchd runs a missed calendar job once on next wake, which is the catch-up you want. It will not
back-fill several missed occurrences, so keep the separate catch-up wrapper.

## Verify before you trust it

The whole point is that this fires when you are not watching, so test it while you are:

1. Run one shot manually with `--force`. Confirm the message arrives on your phone.
2. Schedule a shot two minutes out. Confirm the scheduler fires it and the exit code is 0.
3. Create the flag file and run a shot. Confirm it stays silent.
4. Put the machine to sleep across a scheduled time. Confirm catch-up fires on wake.

Record the outcome in the HQ status file. A reminder system nobody verified is a reminder system
that probably does not work.
