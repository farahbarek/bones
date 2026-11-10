# =======================================================================
#  reconstruction.py  —  Moteur de reconstruction 3D
#
#  Ce fichier contient TOUT l'algorithme de reconstruction volumétrique.
#  Il transforme des coupes 2D DICOM en un maillage 3D (mesh).
#
#  Algorithme utilisé : MARCHING CUBES
#  → Standard de référence en imagerie médicale (IRM, Scanner)
#  → Inventé en 1987 par Lorensen & Cline chez General Electric
#
#  Niveau : DÉBUTANT — chaque fonction est expliquée pas à pas
# =======================================================================

# --- Bibliothèques nécessaires ---

import os               # Gestion des fichiers et dossiers
import numpy as np      # Tableaux numériques multi-dimensionnels (très rapide)
import pydicom          # Lecture des fichiers DICOM médicaux
from skimage import measure      # Contient l'algorithme Marching Cubes
from scipy.ndimage import (
    gaussian_filter,             # Filtre de lissage gaussien
    zoom                         # Redimensionnement d'un volume 3D
)


# =======================================================================
#  FONCTION PRINCIPALE — Point d'entrée depuis app.py
# =======================================================================

def reconstruire_volume_3d(dossier_dicom: str, seuil: float = 100,
                            decimate: bool = True) -> dict:
    """
    Reconstruit un maillage 3D à partir d'un dossier contenant des fichiers DICOM.

    Étapes :
      1. Lire et trier les fichiers DICOM
      2. Construire le volume 3D (tableau numpy 3D)
      3. Lisser le volume (réduire le bruit)
      4. Appliquer Marching Cubes → extraire la surface
      5. Optionnel : réduire le nombre de triangles (décimation)
      6. Retourner sommets, faces, normales

    Args:
        dossier_dicom (str)  : Chemin du dossier contenant les .dcm
        seuil         (float): Valeur d'intensité minimale pour l'os (0-255)
        decimate      (bool) : Réduire le maillage pour accélérer l'affichage

    Returns:
        dict avec les clés : vertices, faces, normales, dimensions
    """

    print(f"\n--- ÉTAPE 1 : Lecture des fichiers DICOM dans '{dossier_dicom}' ---")
    volume = lire_et_construire_volume(dossier_dicom)

    print(f"--- ÉTAPE 2 : Volume construit : {volume.shape} voxels ---")
    print(f"    Min={volume.min():.1f}  Max={volume.max():.1f}  Moy={volume.mean():.1f}")

    print(f"--- ÉTAPE 3 : Lissage gaussien (réduction du bruit) ---")
    volume_lisse = lisser_volume(volume)

    print(f"--- ÉTAPE 4 : Marching Cubes (seuil={seuil}) ---")
    vertices, faces, normales = appliquer_marching_cubes(volume_lisse, seuil)

    if decimate and len(faces) > 50000:
        print(f"--- ÉTAPE 5 : Décimation ({len(faces)} → moins de triangles) ---")
        vertices, faces, normales = decimer_mesh(vertices, faces, normales)

    print(f"--- TERMINÉ : {len(vertices)} sommets, {len(faces)} triangles ---\n")

    return {
        "vertices"  : vertices.flatten().tolist(),   # Converti en liste Python
        "faces"     : faces.flatten().tolist(),
        "normales"  : normales.flatten().tolist(),
        "dimensions": list(volume.shape)             # (profondeur, hauteur, largeur)
    }


# =======================================================================
#  ÉTAPE 1 — Lire les fichiers DICOM et construire le volume 3D
# =======================================================================

def lire_et_construire_volume(dossier: str) -> np.ndarray:
    """
    Lit tous les fichiers .dcm du dossier, extrait les pixels de chaque coupe,
    et les empile pour former un tableau 3D : volume[z, y, x].

    Imagine un livre :
      - Chaque page = une coupe 2D (image DICOM)
      - Le livre entier = le volume 3D

    Args:
        dossier (str): Chemin du dossier DICOM

    Returns:
        np.ndarray de forme (nb_coupes, hauteur, largeur), valeurs 0-255
    """

    # --- Lister tous les fichiers du dossier ---
    fichiers = []
    for nom in os.listdir(dossier):
        chemin = os.path.join(dossier, nom)
        if os.path.isfile(chemin):
            fichiers.append(chemin)

    if len(fichiers) < 2:
        raise ValueError(f"Pas assez de fichiers DICOM dans {dossier}")

    # --- Lire chaque fichier et trier par position Z ---
    # En DICOM, la position dans l'espace est stockée dans le tag
    # "ImagePositionPatient" (0020,0032) : [x, y, z_du_patient]
    coupes = []

    for chemin in fichiers:
        try:
            ds = pydicom.dcmread(chemin)   # Lecture du fichier DICOM

            # Extraction des pixels
            # pixel_array() retourne un tableau numpy 2D de la coupe
            pixels = ds.pixel_array.astype(np.float32)

            # Récupérer la position Z pour trier les coupes dans le bon ordre
            pos_z = extraire_position_z(ds)

            coupes.append((pos_z, pixels))

        except Exception as e:
            print(f"  ⚠ Fichier ignoré ({os.path.basename(chemin)}) : {e}")
            continue

    if len(coupes) < 2:
        raise ValueError("Impossible de lire les coupes DICOM.")

    # --- Trier les coupes par position Z (ordre anatomique) ---
    coupes.sort(key=lambda c: c[0])    # Trier par le premier élément (pos_z)

    # --- Empiler les coupes en un tableau 3D ---
    # np.stack transforme une liste de matrices 2D en un tableau 3D
    tableaux_pixels = [coupe[1] for coupe in coupes]  # Garder seulement les pixels
    volume = np.stack(tableaux_pixels, axis=0)         # axis=0 = axe Z (profondeur)

    # --- Normaliser les valeurs sur 0-255 ---
    # Les DICOM peuvent avoir des valeurs HU (Hounsfield Units) négatives
    volume = normaliser_volume(volume)

    return volume   # Forme : (nb_coupes, hauteur, largeur)


def extraire_position_z(ds) -> float:
    """
    Extrait la position Z d'une coupe DICOM.
    Si le tag n'existe pas, utilise le numéro d'instance à la place.

    Les scanners médicaux stockent la position spatiale de chaque coupe
    dans les métadonnées DICOM pour qu'on puisse les remettre dans l'ordre.

    Args:
        ds: Dataset pydicom

    Returns:
        float: La position Z de la coupe
    """

    # Tag (0020,0032) : "Image Position Patient" = [x, y, z]
    if hasattr(ds, 'ImagePositionPatient'):
        return float(ds.ImagePositionPatient[2])   # On prend le Z

    # Tag (0020,0013) : "Instance Number" (numéro de coupe)
    if hasattr(ds, 'InstanceNumber'):
        return float(ds.InstanceNumber)

    # En dernier recours, valeur aléatoire (l'ordre ne sera pas garanti)
    return 0.0


def normaliser_volume(volume: np.ndarray) -> np.ndarray:
    """
    Normalise toutes les valeurs du volume entre 0 et 255.
    Nécessaire car les valeurs DICOM peuvent aller de -1000 à +3000 (Unités Hounsfield).

    HU (Hounsfield Units) :
      Air   = -1000
      Eau   =     0
      Os    = +400 à +1000
      Métal = +1000 à +3000

    Args:
        volume (np.ndarray): Volume brut

    Returns:
        np.ndarray: Volume avec valeurs 0-255 (uint8)
    """

    vmin = volume.min()
    vmax = volume.max()

    if vmax == vmin:
        return np.zeros_like(volume, dtype=np.uint8)

    # Formule de normalisation : valeur_normalisée = (v - min) / (max - min) * 255
    volume_norm = (volume - vmin) / (vmax - vmin) * 255.0

    return volume_norm.astype(np.uint8)


# =======================================================================
#  ÉTAPE 3 — Lissage du volume (réduction du bruit)
# =======================================================================

def lisser_volume(volume: np.ndarray, sigma: float = 1.0) -> np.ndarray:
    """
    Applique un filtre gaussien 3D pour lisser le volume.
    Cela réduit le bruit et donne un rendu plus propre.

    Le filtre gaussien "floute" légèrement l'image, comme passer une loupe
    qui mélange un peu les voisins — cela gomme les pixels parasites.

    Args:
        volume (np.ndarray): Volume 3D brut
        sigma  (float)     : Force du lissage (0 = pas de lissage, 2 = fort)

    Returns:
        np.ndarray: Volume lissé (float32)
    """

    volume_float = volume.astype(np.float32)

    # gaussian_filter applique le filtre dans les 3 directions (X, Y, Z)
    volume_lisse = gaussian_filter(volume_float, sigma=sigma)

    return volume_lisse


# =======================================================================
#  ÉTAPE 4 — ALGORITHME MARCHING CUBES
#  C'est le cœur de la reconstruction 3D !
# =======================================================================

def appliquer_marching_cubes(volume: np.ndarray, seuil: float) -> tuple:
    """
    Applique l'algorithme Marching Cubes pour extraire une surface 3D
    à partir d'un volume de voxels.

    ┌─────────────────────────────────────────────────────┐
    │  COMMENT FONCTIONNE MARCHING CUBES ?                │
    │                                                     │
    │  Imagine le volume découpé en petits cubes 3D.      │
    │  Chaque cube a 8 coins (voxels).                    │
    │  Pour chaque cube :                                 │
    │   • Chaque coin est soit "dedans" (≥ seuil)         │
    │     soit "dehors" (< seuil)                         │
    │   • Il y a 2^8 = 256 combinaisons possibles          │
    │   • Une table de correspondance dit comment         │
    │     dessiner les triangles pour chaque combinaison  │
    │   → On obtient une surface lisse et précise !       │
    └─────────────────────────────────────────────────────┘

    Args:
        volume (np.ndarray): Volume 3D lissé
        seuil  (float)     : Valeur iso-surface (intensité de l'os)

    Returns:
        (vertices, faces, normales) : Les 3 composantes du maillage
    """

    # Vérifier que le seuil est dans la plage des données
    seuil_reel = np.clip(seuil, volume.min() + 1, volume.max() - 1)

    if seuil_reel != seuil:
        print(f"  ⚠ Seuil ajusté de {seuil} → {seuil_reel:.1f}")

    # --- Application de Marching Cubes ---
    # measure.marching_cubes est la fonction de scikit-image
    # Elle retourne :
    #   verts  : coordonnées (x,y,z) de chaque sommet du maillage
    #   faces  : indices des sommets formant chaque triangle
    #   norms  : vecteur normal de chaque sommet (pour l'éclairage 3D)
    #   values : valeur d'intensité à chaque sommet (non utilisé ici)
    verts, faces, norms, values = measure.marching_cubes(
        volume,
        level        = seuil_reel,  # La valeur iso-surface
        step_size    = 2,           # Pas d'échantillonnage (2 = moins de détails, plus rapide)
        allow_degenerate = False    # Éviter les triangles plats dégénérés
    )

    # --- Centrer le mesh sur l'origine (0,0,0) ---
    centre = verts.mean(axis=0)   # Calculer le centre de masse
    verts  = verts - centre       # Déplacer pour centrer

    # --- Normaliser la taille (ramener à une échelle ~100 unités) ---
    taille_max = np.abs(verts).max()
    if taille_max > 0:
        verts = verts / taille_max * 100

    return verts, faces, norms


# =======================================================================
#  ÉTAPE 5 — DÉCIMATION (optionnelle)
#  Réduire le nombre de triangles pour accélérer l'affichage
# =======================================================================

def decimer_mesh(vertices: np.ndarray, faces: np.ndarray,
                  normales: np.ndarray, ratio: float = 0.5) -> tuple:
    """
    Réduit le nombre de triangles du maillage par sous-échantillonnage simple.

    Un scanner médical peut produire des millions de triangles.
    On en conserve seulement une partie pour que le navigateur puisse
    afficher le résultat sans ramer.

    Méthode : on garde 1 face sur (1/ratio)
    ratio=0.5 → on garde 50% des faces

    Args:
        vertices  : Tableau de sommets (N×3)
        faces     : Tableau de triangles (M×3)
        normales  : Tableau de normales (N×3)
        ratio     : Fraction des faces à conserver (0.1 à 1.0)

    Returns:
        (vertices, faces, normales) réduits
    """

    nb_faces_original = len(faces)

    # On prend 1 face sur (1/ratio)
    pas = max(1, int(1.0 / ratio))
    faces_reduites = faces[::pas]   # Sous-échantillonnage régulier

    # Trouver les sommets réellement utilisés par les faces restantes
    indices_utilises = np.unique(faces_reduites)   # Indices sans doublon

    # Créer un mapping ancien_indice → nouvel_indice
    mapping = np.full(len(vertices), -1, dtype=np.int32)
    for nouvel_idx, ancien_idx in enumerate(indices_utilises):
        mapping[ancien_idx] = nouvel_idx

    # Reconstruire les faces avec les nouveaux indices
    # On garde seulement les faces dont tous les sommets sont valides
    masque = (mapping[faces_reduites] >= 0).all(axis=1)
    faces_finales    = mapping[faces_reduites[masque]]
    vertices_finales = vertices[indices_utilises]
    normales_finales = normales[indices_utilises]

    print(f"  Décimation : {nb_faces_original} → {len(faces_finales)} triangles "
          f"({100*len(faces_finales)//nb_faces_original}% conservés)")

    return vertices_finales, faces_finales, normales_finales
