@echo off
rem Claude Brain tunnel (Windows). Keeps a reverse SSH tunnel to your server open, so Claude Code sessions
rem running there can reach the plugin on this computer, and reconnects when it drops. Close the window to stop.
rem
rem 1. Set SERVER to your SSH login (key-based login must already work: ssh user@host).
rem 2. On the server, once, with this window open:  curl -s http://127.0.0.1:27182/install.sh | sh
set SERVER=user@your-server
set PORT=27182
title Claude Brain tunnel
:loop
echo [%date% %time%] connecting to %SERVER% ...
ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R %PORT%:127.0.0.1:%PORT% %SERVER% "test -f ~/.claude/brain-link.sh && exec sh ~/.claude/brain-link.sh || exec sleep 2147483647"
echo [%date% %time%] tunnel closed, reconnecting in 5 seconds. Ctrl+C to stop.
timeout /t 5 /nobreak >nul
goto loop
