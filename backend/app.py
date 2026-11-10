# =======================================================================
#  app.py  —  Serveur Backend Flask
#  Rôle : recevoir les fichiers DICOM du navigateur, reconstruire
#          un volume 3D et renvoyer le maillage (mesh) au format JSON.
#
#  Niveau : DÉBUTANT — chaque ligne est expliquée en français
# =======================================================================

# --- Importation des bibliothèques ---

from flask import Flask, request, jsonify
# Flask  : framework web léger qui crée un serveur HTTP
# request: objet qui contient ce que le navigateur nous envoie
# jsonify: convertit un dictionnaire Python en réponse JSON

from flask_cors import CORS
# CORS : autorise le navigateur à appeler notre serveur
# (sans ça, le navigateur bloque les requêtes pour des raisons de sécurité)

import os
# os : gestion des dossiers et fichiers

import uuid
# uuid : génère des identifiants uniques (pour nommer les sessions)

import shutil
# shutil : copier / supprimer des dossiers entiers

from reconstruction import reconstruire_volume_3d
# Notre module maison qui fait tout le travail de reconstruction

# =======================================================================
#  INITIALISATION DE L'APPLICATION FLASK
# =======================================================================

app = Flask(__name__)   # Crée l'application Flask
CORS(app)               # Autorise toutes les origines (navigateur local)

# Dossier temporaire où seront stockés les fichiers DICOM uploadés
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)   # Crée le dossier s'il n'existe pas

# Taille maximale d'upload acceptée : 500 Mo
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024


# =======================================================================
#  ROUTE 1 — Page de test (vérifier que le serveur tourne)
#  Accès : http://localhost:5000/
# =======================================================================

@app.route('/', methods=['GET'])
def accueil():
    """Route de bienvenue pour vérifier que le serveur fonctionne."""
    return jsonify({
        "message": "✅ Backend OstoView 3D opérationnel",
        "version": "1.0",
        "routes": {
            "POST /upload"      : "Uploader les fichiers DICOM",
            "POST /reconstruct" : "Reconstruire le volume 3D",
            "DELETE /session/<id>": "Supprimer une session"
        }
    })


# =======================================================================
#  ROUTE 2 — Upload des fichiers DICOM
#  Accès : POST http://localhost:5000/upload
#  Reçoit : des fichiers DICOM (multipart/form-data)
#  Renvoie: un identifiant de session + statistiques
# =======================================================================

@app.route('/upload', methods=['POST'])
def upload_fichiers():
    """
    Reçoit les fichiers DICOM du navigateur et les sauvegarde sur le serveur.
    Retourne un 'session_id' que le frontend utilisera pour la reconstruction.
    """

    # Vérifier qu'il y a bien des fichiers dans la requête
    if 'files' not in request.files:
        return jsonify({"erreur": "Aucun fichier reçu"}), 400

    fichiers = request.files.getlist('files')   # Liste de tous les fichiers envoyés

    if len(fichiers) < 10:
        return jsonify({"erreur": f"Minimum 10 fichiers requis. Reçu : {len(fichiers)}"}), 400

    # Créer un dossier unique pour cette session (evite les conflits entre utilisateurs)
    session_id = str(uuid.uuid4())              # Ex: "a3f2c1d4-..."
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir)

    # Sauvegarder chaque fichier sur le disque
    noms_sauvegardes = []
    for fichier in fichiers:
        if fichier.filename == '':
            continue   # Ignorer les fichiers sans nom

        # Chemin complet de destination
        chemin = os.path.join(session_dir, fichier.filename)
        fichier.save(chemin)                    # Écriture sur le disque
        noms_sauvegardes.append(fichier.filename)

    print(f"📂 Session {session_id} : {len(noms_sauvegardes)} fichiers sauvegardés")

    return jsonify({
        "succes"     : True,
        "session_id" : session_id,
        "nb_fichiers": len(noms_sauvegardes),
        "fichiers"   : noms_sauvegardes
    })


# =======================================================================
#  ROUTE 3 — Reconstruction 3D
#  Accès : POST http://localhost:5000/reconstruct
#  Reçoit : { "session_id": "...", "seuil": 100, "decimate": true }
#  Renvoie: le maillage 3D (sommets + faces + normales) au format JSON
# =======================================================================

@app.route('/reconstruct', methods=['POST'])
def reconstruire():
    """
    Prend les fichiers DICOM d'une session, reconstruit le volume 3D
    via l'algorithme Marching Cubes et renvoie le maillage.
    """

    # Lire les paramètres envoyés par le frontend (format JSON)
    donnees  = request.get_json()
    session_id = donnees.get('session_id')
    seuil      = donnees.get('seuil', 100)      # Seuil d'intensité (0-255)
    decimate   = donnees.get('decimate', True)  # Réduire le nombre de triangles

    # Vérifier que la session existe
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    if not os.path.isdir(session_dir):
        return jsonify({"erreur": "Session introuvable. Re-uploadez vos fichiers."}), 404

    print(f"🔬 Reconstruction session {session_id} | seuil={seuil} | décimation={decimate}")

    try:
        # ---- Appel de la fonction de reconstruction ----
        # (définie dans reconstruction.py)
        resultat = reconstruire_volume_3d(
            dossier_dicom = session_dir,
            seuil         = seuil,
            decimate      = decimate
        )

        print(f"✅ Mesh : {len(resultat['vertices'])//3} sommets, "
              f"{len(resultat['faces'])//3} triangles")

        return jsonify({
            "succes"       : True,
            "vertices"     : resultat['vertices'],    # Liste [x,y,z, x,y,z, ...]
            "faces"        : resultat['faces'],        # Liste [i,j,k, i,j,k, ...]
            "normales"     : resultat['normales'],     # Liste [nx,ny,nz, ...]
            "nb_vertices"  : len(resultat['vertices']) // 3,
            "nb_triangles" : len(resultat['faces'])    // 3,
            "dimensions"   : resultat['dimensions'],   # (W, H, D)
            "seuil_utilise": seuil
        })

    except Exception as erreur:
        print(f"❌ Erreur reconstruction : {erreur}")
        return jsonify({"erreur": str(erreur)}), 500


# =======================================================================
#  ROUTE 4 — Exporter en OBJ (format 3D standard)
#  Accès : POST http://localhost:5000/export_obj
#  Renvoie: un fichier .obj téléchargeable
# =======================================================================

@app.route('/export_obj', methods=['POST'])
def exporter_obj():
    """
    Génère un fichier .OBJ (format 3D universel, compatible Blender, MeshLab…)
    à partir du dernier mesh calculé.
    """
    from flask import Response

    donnees    = request.get_json()
    session_id = donnees.get('session_id')
    seuil      = donnees.get('seuil', 100)

    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    if not os.path.isdir(session_dir):
        return jsonify({"erreur": "Session introuvable"}), 404

    resultat = reconstruire_volume_3d(session_dir, seuil=seuil, decimate=True)

    # Générer le contenu du fichier OBJ
    # Un fichier OBJ est un simple fichier texte :
    # "v x y z"  = définit un sommet (vertex)
    # "f i j k"  = définit un triangle (face) par indices de sommets
    lignes = ["# OstoView 3D — Fichier OBJ exporté", "# www.ostoview.local", ""]

    verts = resultat['vertices']
    faces = resultat['faces']

    # Ajouter les sommets
    for i in range(0, len(verts), 3):
        lignes.append(f"v {verts[i]:.4f} {verts[i+1]:.4f} {verts[i+2]:.4f}")

    lignes.append("")

    # Ajouter les faces (indices 1-based en OBJ)
    for i in range(0, len(faces), 3):
        a, b, c = faces[i]+1, faces[i+1]+1, faces[i+2]+1
        lignes.append(f"f {a} {b} {c}")

    contenu_obj = "\n".join(lignes)

    # Renvoyer comme fichier téléchargeable
    return Response(
        contenu_obj,
        mimetype='text/plain',
        headers={"Content-Disposition": "attachment; filename=os_3d.obj"}
    )


# =======================================================================
#  ROUTE 5 — Supprimer une session (libérer l'espace disque)
#  Accès : DELETE http://localhost:5000/session/<session_id>
# =======================================================================

@app.route('/session/<session_id>', methods=['DELETE'])
def supprimer_session(session_id):
    """Supprime les fichiers temporaires d'une session."""
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    if os.path.isdir(session_dir):
        shutil.rmtree(session_dir)   # Supprime le dossier et tout son contenu
        return jsonify({"succes": True, "message": "Session supprimée"})
    return jsonify({"erreur": "Session introuvable"}), 404


# =======================================================================
#  LANCEMENT DU SERVEUR
#  python app.py  →  démarre sur http://localhost:5000
# =======================================================================

if __name__ == '__main__':
    print("=" * 50)
    print("🦴 OstoView 3D — Backend Flask")
    print("   Serveur sur : http://localhost:5000")
    print("=" * 50)
    app.run(
        host  = '0.0.0.0',   # Accessible depuis toutes les interfaces réseau
        port  = 5000,         # Port d'écoute
        debug = True          # Mode debug : affiche les erreurs détaillées
    )
