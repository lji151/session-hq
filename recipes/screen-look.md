# Recipe: let a session see the screen

Sometimes the fastest way to explain a problem is to point at it. "The dialog is wrong" costs a
dozen turns to describe and one screenshot to show.

This recipe captures the screen to a PNG that a session can then read.

## When this is the right tool

**Good for:** a GUI application no automation can reach; a rendering bug that only shows in a real
browser at a real size; an error dialog from something you did not launch; anything where
describing the layout is harder than showing it.

**Wrong for:** a web page you control — a browser automation tool gives you the DOM, which is far
more useful than pixels. Anything with a text representation should be handed over as text.

## Windows — PowerShell

```powershell
# capture-screen.ps1 — capture all monitors to a PNG
# usage: powershell -ExecutionPolicy Bypass -File capture-screen.ps1 [out.png]
param([string]$OutPath = "$env:TEMP\screen-capture.png")

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Without this, a scaled display captures at logical size and the result is blurry
Add-Type @"
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DpiHelper]::SetProcessDPIAware() | Out-Null

$vs  = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
try {
    $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $g.Dispose(); $bmp.Dispose()
}
"saved: $OutPath ($($vs.Width)x$($vs.Height))"
```

`VirtualScreen` spans every monitor, so a multi-monitor setup produces one wide image. For a
single display, use `[System.Windows.Forms.Screen]::PrimaryScreen.Bounds` instead.

## macOS

```bash
# Whole screen, no shutter sound, no window shadow
screencapture -x -o ~/screen.png

# Interactive region or window selection
screencapture -i ~/screen.png

# One specific display (1-indexed)
screencapture -x -D 1 ~/screen.png
```

macOS requires **Screen Recording** permission for the terminal or the process invoking it:
System Settings → Privacy & Security → Screen Recording. Without it, `screencapture` silently
produces a desktop-wallpaper-only image, which is a confusing failure — check the output the first
time rather than assuming it worked.

## Linux

Depends on the display server:

```bash
# Wayland (GNOME)
gnome-screenshot -f ~/screen.png

# Wayland (wlroots: sway, hyprland)
grim ~/screen.png

# X11
import -window root ~/screen.png     # ImageMagick
scrot ~/screen.png                   # or scrot
maim ~/screen.png                    # or maim
```

Under Wayland, generic X11 tools mostly do not work — the compositor is the only thing that can
grant a capture, which is a security feature, not a bug. Detect with `$XDG_SESSION_TYPE` and pick
the right tool rather than trying them in sequence and confusing the failures.

## Using it from a session

Two steps. Capture, then read the PNG.

```
> take a look at my screen

  [runs the capture script]
  [reads the PNG]

The dialog on the right has its two buttons swapped relative to the rest of the app —
"Cancel" is on the right where "Save" is everywhere else.
```

Practical notes:

- **Write to a temp path and overwrite it.** You do not want a directory of screenshots
  accumulating, and stale files are worse than no files: a session reading yesterday's capture and
  confidently describing the wrong thing is a real failure mode. Include a timestamp in the
  output, or check the file's mtime before trusting it.
- **Full screen captures are large.** Crop, or capture one window, when you know what you need.
- **Nothing is streaming.** Each capture is one still. If you need "watch what happens when I
  click", take before and after.

## Privacy

A screenshot captures whatever is on screen, including the things you forgot were on screen:
another chat window, an open password manager, a private repository, someone else's email.

- Close or minimise anything you would not paste into the conversation.
- Prefer window or region capture over full-screen when you can.
- Treat the resulting file as sensitive. Delete it when done; do not commit it; do not leave a
  folder of them synced somewhere.
- On a shared or work machine, check whether screen capture is permitted at all before setting
  this up.

## Optional: wire it to a command

A small slash command makes this one keystroke — capture to a fixed temp path, then read it. Keep
the capture explicit rather than automatic: a session that can look at the screen whenever it
likes is a much bigger permission than one that looks when asked.
