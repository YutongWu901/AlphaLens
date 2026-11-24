@echo off
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 goto usepython
py -3 serve.py
goto done
:usepython
python serve.py
:done
if errorlevel 1 pause

