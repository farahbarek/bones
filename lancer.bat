@echo off
:: ============================================================
::  lancer.bat — Lance le backend Flask + ouvre le frontend
::  Double-cliquez sur ce fichier pour tout démarrer !
:: ============================================================

title OstoView 3D — Lancement

echo.
echo  =========================================
echo   Lancement OstoView 3D
echo  =========================================
echo.

:: Aller dans le dossier backend
cd /d "%~dp0backend"

:: Vérifier si Python est installé
python --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo [ERREUR] Python n'est pas installe ou pas dans le PATH.
    echo Telechargez Python sur : https://www.python.org/downloads/
    pause
    exit /b
)

:: Installer les dépendances si nécessaire
echo [1/3] Installation des dependances Python...
pip install -r requirements.txt --quiet

echo [2/3] Demarrage du serveur Flask sur http://localhost:5000 ...
echo       (Ne fermez pas cette fenetre !)
echo.

:: Ouvrir le navigateur après 3 secondes
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5500/index.html"

:: Lancer un mini serveur pour le frontend dans un autre terminal
echo [3/3] Demarrage du serveur frontend sur http://localhost:5500 ...
start "" cmd /k "cd /d %~dp0 && python -m http.server 5500"

:: Lancer Flask (bloque jusqu'à Ctrl+C)
python app.py

pause
