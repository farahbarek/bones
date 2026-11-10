/* =====================================================================
   app.js  –  OstoView 3D (version avec Backend Python)
   
   Ce fichier gère :
     1. L'interface utilisateur (upload, aperçu, contrôles)
     2. La communication avec le serveur Flask (envoi DICOM, réception mesh)
     3. L'affichage 3D du maillage reçu avec Three.js
   
   Niveau : DÉBUTANT — chaque bloc est expliqué en français
   ===================================================================== */

// ═══════════════════════════════════════════════════════════════════
//  PARTIE 1 — CONFIGURATION ET VARIABLES GLOBALES
// ═══════════════════════════════════════════════════════════════════

// URL du serveur backend Flask
// Si Flask tourne sur votre machine, c'est toujours cette adresse
const API_URL = 'http://localhost:5000';

// --- Référence aux éléments HTML ---
const fileInput      = document.getElementById('fileInput');
const dropzone       = document.getElementById('dropzone');
const fileCount      = document.getElementById('fileCount');
const previewGrid    = document.getElementById('previewGrid');
const btnReconstruct = document.getElementById('btnReconstruct');

const stepUpload   = document.getElementById('step-upload');
const stepProgress = document.getElementById('step-progress');
const stepViewer   = document.getElementById('step-viewer');

const progressFill  = document.getElementById('progressFill');
const progressPct   = document.getElementById('progressPct');
const progressLabel = document.getElementById('progressLabel');

const canvas3d        = document.getElementById('canvas3d');
const sliderThreshold = document.getElementById('sliderThreshold');
const valThreshold    = document.getElementById('valThreshold');
const sliderOpacity   = document.getElementById('sliderOpacity');
const valOpacity      = document.getElementById('valOpacity');
const colorBtns       = document.querySelectorAll('.color-btn');
const selectMode      = document.getElementById('selectMode');
const chkAutoRotate   = document.getElementById('chkAutoRotate');
const btnReset        = document.getElementById('btnReset');
const btnNewUpload    = document.getElementById('btnNewUpload');
const infoBox         = document.getElementById('infoBox');

// --- Variables d'état ---
let selectedFiles = [];    // Fichiers choisis
let sessionId     = null;  // ID de session renvoyé par le backend
let currentColor  = '#f0d9b5';

// --- Variables Three.js ---
let renderer, scene, camera, controls;
let currentMesh  = null;
let animFrameId  = null;


// ═══════════════════════════════════════════════════════════════════
//  PARTIE 2 — DRAG & DROP ET SÉLECTION DE FICHIERS
// ═══════════════════════════════════════════════════════════════════

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

function handleFiles(files) {
  selectedFiles = Array.from(files);
  const count = selectedFiles.length;

  if (count === 0) {
    fileCount.textContent = 'Aucun fichier sélectionné';
    fileCount.style.color = '';
  } else if (count < 10) {
    fileCount.textContent = `⚠️ ${count} fichier(s) — minimum 10 requis`;
    fileCount.style.color = '#f59e0b';
  } else {
    fileCount.textContent = `✅ ${count} fichier(s) DICOM prêts`;
    fileCount.style.color = '#22d3a0';
  }

  btnReconstruct.disabled = count < 10;
  afficherApercu(selectedFiles);
}


// ═══════════════════════════════════════════════════════════════════
//  PARTIE 3 — MINIATURES (aperçu local sans serveur)
// ═══════════════════════════════════════════════════════════════════

async function afficherApercu(files) {
  previewGrid.innerHTML = '';
  const limite = Math.min(files.length, 20);

  for (let i = 0; i < limite; i++) {
    const item = document.createElement('div');
    item.className = 'preview-item';

    try {
      const ab  = await lireFichierBrut(files[i]);
      const ds  = dicomParser.parseDicom(new Uint8Array(ab));
      const { pixels, largeur, hauteur } = extrairePixelsLocaux(ds);

      const cv = document.createElement('canvas');
      cv.width = largeur; cv.height = hauteur;
      dessinerCoupe(cv, pixels, largeur, hauteur);

      const lbl = document.createElement('div');
      lbl.className   = 'slice-label';
      lbl.textContent = `#${i + 1}`;

      item.appendChild(cv);
      item.appendChild(lbl);
    } catch {
      item.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f59e0b;font-size:1.5rem">?</div>';
    }

    previewGrid.appendChild(item);
  }

  if (files.length > limite) {
    const more = document.createElement('div');
    more.className = 'preview-item';
    more.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:0.75rem;text-align:center">+${files.length - limite} autres</div>`;
    previewGrid.appendChild(more);
  }
}

// Lire un fichier en binaire brut
function lireFichierBrut(file) {
  return new Promise((ok, err) => {
    const r = new FileReader();
    r.onload  = () => ok(r.result);
    r.onerror = err;
    r.readAsArrayBuffer(file);
  });
}

// Extraction locale (pour les miniatures uniquement)
function extrairePixelsLocaux(ds) {
  const largeur = ds.uint16('x00280011') || 512;
  const hauteur = ds.uint16('x00280010') || 512;
  const bits    = ds.uint16('x00280100') || 16;
  const el      = ds.elements['x7fe00010'];
  const offset  = el.dataOffset;

  let pixels = new Uint8Array(largeur * hauteur);

  if (bits === 8) {
    for (let i = 0; i < pixels.length; i++)
      pixels[i] = ds.byteArray[offset + i];
  } else {
    const raw = new Int16Array(ds.byteArray.buffer, offset, el.length / 2);
    let mn = Infinity, mx = -Infinity;
    for (let v of raw) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = mx - mn || 1;
    for (let i = 0; i < raw.length && i < pixels.length; i++)
      pixels[i] = Math.round(((raw[i] - mn) / range) * 255);
  }

  return { pixels, largeur, hauteur };
}

function dessinerCoupe(cv, pixels, w, h) {
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = pixels[i];
    img.data[i*4] = v; img.data[i*4+1] = v; img.data[i*4+2] = v; img.data[i*4+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}


// ═══════════════════════════════════════════════════════════════════
//  PARTIE 4 — UPLOAD VERS LE BACKEND + RECONSTRUCTION
//
//  Flux complet :
//    navigateur → POST /upload  → backend sauvegarde les fichiers
//    navigateur → POST /reconstruct → backend calcule le mesh
//    navigateur reçoit le mesh JSON → Three.js l'affiche
// ═══════════════════════════════════════════════════════════════════

btnReconstruct.addEventListener('click', async () => {
  stepUpload.classList.add('hidden');
  stepProgress.classList.remove('hidden');
  stepViewer.classList.add('hidden');

  try {

    // ── ÉTAPE A : Vérifier que le serveur Flask est allumé ──────────
    mettreAJourProgression(5, 'Connexion au serveur Flask…');
    await verifierServeur();

    // ── ÉTAPE B : Envoyer les fichiers au backend ───────────────────
    mettreAJourProgression(10, `Envoi de ${selectedFiles.length} fichiers DICOM au serveur…`);
    sessionId = await uploadFichiers(selectedFiles, (pct) => {
      mettreAJourProgression(10 + Math.round(pct * 0.5), `Upload : ${Math.round(pct)}%`);
    });

    // ── ÉTAPE C : Demander la reconstruction 3D ─────────────────────
    mettreAJourProgression(65, 'Reconstruction 3D en cours (Marching Cubes)…');
    const mesh = await demanderReconstruction(sessionId, parseInt(sliderThreshold.value));

    // ── ÉTAPE D : Afficher le mesh 3D avec Three.js ─────────────────
    mettreAJourProgression(90, 'Affichage du modèle 3D…');
    await pause(100);

    initialiserScene();
    afficherMesh(mesh);

    mettreAJourProgression(100, 'Terminé !');
    await pause(400);

    // ── ÉTAPE E : Afficher la visionneuse ───────────────────────────
    stepProgress.classList.add('hidden');
    stepViewer.classList.remove('hidden');

    infoBox.innerHTML = `
      <strong style="color:#e2e8f0">Informations volume</strong><br>
      Coupes utilisées : <span style="color:#4f8ef7">${selectedFiles.length}</span><br>
      Sommets 3D : <span style="color:#4f8ef7">${mesh.nb_vertices.toLocaleString()}</span><br>
      Triangles : <span style="color:#4f8ef7">${mesh.nb_triangles.toLocaleString()}</span><br>
      Dimensions : <span style="color:#4f8ef7">${mesh.dimensions.join(' × ')} voxels</span><br>
      Seuil utilisé : <span style="color:#4f8ef7">${mesh.seuil_utilise}</span>
    `;

  } catch (erreur) {
    // En cas d'erreur, on revient à l'upload avec un message
    stepProgress.classList.add('hidden');
    stepUpload.classList.remove('hidden');
    afficherErreur(erreur.message);
  }
});


// ─────────────────────────────────────────────────────────────────
//  Vérifie que le serveur Flask répond
// ─────────────────────────────────────────────────────────────────
async function verifierServeur() {
  try {
    const rep = await fetch(`${API_URL}/`, { method: 'GET' });
    if (!rep.ok) throw new Error();
  } catch {
    throw new Error(
      '❌ Impossible de joindre le serveur Flask.\n' +
      'Lancez le backend avec : cd backend && python app.py'
    );
  }
}


// ─────────────────────────────────────────────────────────────────
//  Envoie les fichiers DICOM au serveur (multipart/form-data)
//  Retourne le session_id fourni par le backend
// ─────────────────────────────────────────────────────────────────
async function uploadFichiers(fichiers, onProgres) {
  /*
   * FormData : permet d'envoyer des fichiers via HTTP POST,
   * exactement comme un formulaire HTML classique.
   */
  const formData = new FormData();
  for (const f of fichiers) {
    formData.append('files', f);  // Clé 'files' = ce que Flask lit
  }

  // XMLHttpRequest permet de suivre la progression de l'upload
  return new Promise((ok, err) => {
    const xhr = new XMLHttpRequest();

    // Événement de progression (en %)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgres((e.loaded / e.total) * 100);
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        ok(data.session_id);  // Retourner l'ID de session
      } else {
        const data = JSON.parse(xhr.responseText);
        err(new Error(data.erreur || 'Erreur lors de l\'upload'));
      }
    };

    xhr.onerror = () => err(new Error('Erreur réseau lors de l\'upload'));

    xhr.open('POST', `${API_URL}/upload`);
    xhr.send(formData);
  });
}


// ─────────────────────────────────────────────────────────────────
//  Demande la reconstruction 3D au backend
//  Retourne le mesh JSON { vertices, faces, normales, ... }
// ─────────────────────────────────────────────────────────────────
async function demanderReconstruction(sid, seuil) {
  /*
   * fetch() = outil moderne pour faire des requêtes HTTP.
   * On envoie un JSON avec les paramètres de reconstruction.
   */
  const reponse = await fetch(`${API_URL}/reconstruct`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },   // On envoie du JSON
    body   : JSON.stringify({
      session_id: sid,
      seuil     : seuil,
      decimate  : true   // Réduction du nombre de triangles
    })
  });

  const data = await reponse.json();   // Lire la réponse JSON

  if (!reponse.ok || !data.succes) {
    throw new Error(data.erreur || 'Erreur de reconstruction');
  }

  return data;   // { vertices, faces, normales, nb_vertices, nb_triangles, dimensions, seuil_utilise }
}


// ─────────────────────────────────────────────────────────────────
//  Demande un export OBJ et télécharge le fichier
// ─────────────────────────────────────────────────────────────────
async function exporterOBJ() {
  if (!sessionId) return;

  const reponse = await fetch(`${API_URL}/export_obj`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({
      session_id: sessionId,
      seuil     : parseInt(sliderThreshold.value)
    })
  });

  // Télécharger le fichier
  const blob = await reponse.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'os_3d.obj';
  a.click();
  URL.revokeObjectURL(url);
}


// ═══════════════════════════════════════════════════════════════════
//  PARTIE 5 — MOTEUR THREE.JS (scène 3D)
// ═══════════════════════════════════════════════════════════════════

function initialiserScene() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x060a14, 1);
  }
  renderer.setSize(canvas3d.clientWidth, canvas3d.clientHeight);

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    50, canvas3d.clientWidth / canvas3d.clientHeight, 0.1, 5000
  );
  camera.position.set(0, 0, 300);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Lumières
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const lumDir = new THREE.DirectionalLight(0xffffff, 1.2);
  lumDir.position.set(100, 200, 100);
  scene.add(lumDir);
  const lumBack = new THREE.DirectionalLight(0x8899ff, 0.4);
  lumBack.position.set(-100, -100, -100);
  scene.add(lumBack);

  // Grille de référence
  const grille = new THREE.GridHelper(300, 20, 0x1a2444, 0x1a2444);
  grille.position.y = -120;
  scene.add(grille);

  if (animFrameId) cancelAnimationFrame(animFrameId);
  boucleAnimation();
}

function boucleAnimation() {
  animFrameId = requestAnimationFrame(boucleAnimation);
  if (chkAutoRotate.checked && currentMesh) currentMesh.rotation.y += 0.005;
  controls.update();
  renderer.render(scene, camera);
}


// ═══════════════════════════════════════════════════════════════════
//  PARTIE 6 — AFFICHAGE DU MESH REÇU DU BACKEND
// ═══════════════════════════════════════════════════════════════════

/**
 * Prend les données JSON du backend (vertices, faces, normales)
 * et les convertit en objet Three.js pour l'affichage.
 *
 * @param {Object} meshData - Les données du maillage reçues du serveur
 */
function afficherMesh(meshData) {
  // Supprimer l'ancien mesh
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh.material.dispose();
    currentMesh = null;
  }

  // ── Création de la géométrie Three.js ──
  const geometry = new THREE.BufferGeometry();

  /*
   * Float32Array : tableau de nombres décimaux (coordonnées X,Y,Z)
   * Les données viennent du serveur en liste Python → tableau JS
   */
  const vertices = new Float32Array(meshData.vertices);
  const normales = new Float32Array(meshData.normales);
  const faces    = new Uint32Array(meshData.faces);    // Indices des triangles

  // Associer les tableaux à la géométrie
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal',   new THREE.BufferAttribute(normales, 3));
  geometry.setIndex(new THREE.BufferAttribute(faces, 1));

  // ── Création du matériau et du mesh ──
  const couleur  = parseInt(currentColor.replace('#', '0x'));
  const materiau = creerMateriau(selectMode.value, couleur);

  const mode = selectMode.value;
  if (mode === 'points') {
    // Mode nuage de points : remplace Mesh par Points
    currentMesh = new THREE.Points(geometry, materiau);
  } else {
    currentMesh = new THREE.Mesh(geometry, materiau);
  }

  scene.add(currentMesh);

  // Repositionner la caméra
  camera.position.set(0, 0, 300);
  controls.reset();
}


/**
 * Recharge le mesh depuis le backend avec un nouveau seuil.
 * Appelé quand l'utilisateur bouge le slider.
 */
async function rechargerAvecNouveauSeuil(seuil) {
  if (!sessionId) return;

  // Afficher un indicateur de chargement dans la boîte info
  infoBox.innerHTML = '<span style="color:#4f8ef7">🔄 Recalcul en cours…</span>';
  btnReconstruct.disabled = true;

  try {
    const mesh = await demanderReconstruction(sessionId, seuil);
    afficherMesh(mesh);
    infoBox.innerHTML = `
      <strong style="color:#e2e8f0">Informations volume</strong><br>
      Sommets 3D : <span style="color:#4f8ef7">${mesh.nb_vertices.toLocaleString()}</span><br>
      Triangles : <span style="color:#4f8ef7">${mesh.nb_triangles.toLocaleString()}</span><br>
      Seuil utilisé : <span style="color:#4f8ef7">${mesh.seuil_utilise}</span>
    `;
  } catch (e) {
    infoBox.innerHTML = `<span style="color:#f87171">⚠️ ${e.message}</span>`;
  } finally {
    btnReconstruct.disabled = false;
  }
}


function creerMateriau(mode, couleur) {
  if (mode === 'wireframe') {
    return new THREE.MeshBasicMaterial({ color: couleur, wireframe: true });
  } else if (mode === 'points') {
    return new THREE.PointsMaterial({ color: couleur, size: 0.5 });
  } else {
    return new THREE.MeshPhongMaterial({
      color      : couleur,
      specular   : 0x444444,
      shininess  : 60,
      opacity    : parseFloat(sliderOpacity.value) / 100,
      transparent: true,
      side       : THREE.DoubleSide,
    });
  }
}


// ═══════════════════════════════════════════════════════════════════
//  PARTIE 7 — CONTRÔLES INTERACTIFS
// ═══════════════════════════════════════════════════════════════════

// Seuil : recalcul côté serveur quand on relâche le slider
let timerSeuil = null;
sliderThreshold.addEventListener('input', () => {
  valThreshold.textContent = sliderThreshold.value;
  // On attend 600ms après le dernier mouvement pour éviter trop d'appels réseau
  clearTimeout(timerSeuil);
  timerSeuil = setTimeout(() => {
    if (sessionId) rechargerAvecNouveauSeuil(parseInt(sliderThreshold.value));
  }, 600);
});

// Opacité : changement immédiat (local, pas besoin du serveur)
sliderOpacity.addEventListener('input', () => {
  valOpacity.textContent = sliderOpacity.value + ' %';
  if (currentMesh?.material) currentMesh.material.opacity = parseFloat(sliderOpacity.value) / 100;
});

// Couleur
colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    colorBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentColor = btn.dataset.color;
    if (currentMesh?.material) currentMesh.material.color.set(currentColor);
  });
});

// Mode d'affichage (surface / wireframe / points)
selectMode.addEventListener('change', () => {
  if (currentMesh && sessionId) {
    // On doit recréer le mesh avec le bon matériau
    const couleur = parseInt(currentColor.replace('#', '0x'));
    const matNew  = creerMateriau(selectMode.value, couleur);
    if (currentMesh.material) currentMesh.material.dispose();
    currentMesh.material = matNew;
  }
});

// Réinitialiser la vue
btnReset.addEventListener('click', () => {
  camera.position.set(0, 0, 300);
  controls.reset();
});

// Nouveau chargement
btnNewUpload.addEventListener('click', async () => {
  // Supprimer la session sur le serveur (libérer l'espace disque)
  if (sessionId) {
    try {
      await fetch(`${API_URL}/session/${sessionId}`, { method: 'DELETE' });
    } catch {}
    sessionId = null;
  }

  stepViewer.classList.add('hidden');
  stepProgress.classList.add('hidden');
  stepUpload.classList.remove('hidden');

  selectedFiles = [];
  fileCount.textContent = 'Aucun fichier sélectionné';
  fileCount.style.color = '';
  previewGrid.innerHTML = '';
  btnReconstruct.disabled = true;
  fileInput.value = '';
});

// Redimensionnement de la fenêtre
window.addEventListener('resize', () => {
  if (!renderer || !camera) return;
  renderer.setSize(canvas3d.clientWidth, canvas3d.clientHeight);
  camera.aspect = canvas3d.clientWidth / canvas3d.clientHeight;
  camera.updateProjectionMatrix();
});


// ═══════════════════════════════════════════════════════════════════
//  PARTIE 8 — AJOUT DU BOUTON EXPORT OBJ ET UTILITAIRES
// ═══════════════════════════════════════════════════════════════════

// Ajouter dynamiquement le bouton Export OBJ dans le panneau de contrôles
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('.controls-panel');
  if (!panel) return;

  const btnExport = document.createElement('button');
  btnExport.className   = 'btn-secondary';
  btnExport.id          = 'btnExportObj';
  btnExport.textContent = '💾 Exporter en .OBJ';
  btnExport.onclick     = exporterOBJ;

  // Insérer avant le bouton "Nouveau chargement"
  panel.insertBefore(btnExport, document.getElementById('btnNewUpload'));
});

// Afficher un message d'erreur dans l'interface
function afficherErreur(message) {
  const alerte = document.createElement('div');
  alerte.style.cssText = `
    background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.4);
    border-radius: 10px; padding: 16px; color: #fca5a5; margin-top: 16px;
    font-size: 0.9rem; white-space: pre-line;
  `;
  alerte.textContent = message;

  const ancien = document.querySelector('.erreur-alerte');
  if (ancien) ancien.remove();
  alerte.className = 'erreur-alerte';

  btnReconstruct.insertAdjacentElement('afterend', alerte);
}

// Petite pause asynchrone
function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

// Mise à jour de la barre de progression
function mettreAJourProgression(pct, label) {
  progressFill.style.width = pct + '%';
  progressPct.textContent  = pct + ' %';
  if (label) progressLabel.textContent = label;
}
