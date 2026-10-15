@echo off
echo ============================================
echo  AttendAI - Opening Firewall Ports
echo ============================================
echo.

echo Adding rule for Flask backend (port 5443)...
netsh advfirewall firewall add rule name="AttendAI_Flask_5443" dir=in action=allow protocol=TCP localport=5443
echo.

echo Adding rule for Vite frontend (port 5173)...
netsh advfirewall firewall add rule name="AttendAI_Vite_5173" dir=in action=allow protocol=TCP localport=5173
echo.

echo ============================================
echo  Done! Both ports are now open.
echo  Your phone can now access:
echo  https://10.221.138.1:5443
echo ============================================
echo.
pause
