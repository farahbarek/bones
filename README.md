# OstoView 3D — Reconstruction DICOM

Application web de reconstruction 3D d'images DICOM 2D d'os.

## Structure
```
boussi/
├── index.html          # Interface utilisateur
├── style.css           # Design sombre / glassmorphisme
├── app.js              # Frontend : Three.js + communication backend
├── lancer.bat          # Script de démarrage Windows
└── backend/
    ├── app.py          # Serveur Flask (API REST)
    ├── reconstruction.py  # Algorithme Marching Cubes
    └── requirements.txt   # Dépendances Python
```

## Lancement rapide

### Backend Flask
```bash
cd backend
pip install -r requirements.txt
python app.py
```

### Frontend
```bash
python -m http.server 5500
# Ouvrir : http://localhost:5500
```

Ou double-cliquez sur `lancer.bat` sous Windows.

## Technologies
- **Frontend** : HTML, CSS, JavaScript, Three.js, dicom-parser
- **Backend** : Python, Flask, pydicom, NumPy, scikit-image (Marching Cubes), SciPy
