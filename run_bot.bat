@echo off
cd /d "C:\Users\HP\OneDrive\Desktop\lead follower\server"
:loop
echo Starting WhatsApp Bot...
node index.js
echo Bot crashed or stopped! Restarting in 5 seconds...
timeout /t 5 /nobreak
goto loop
