// MYTHOS PROD — CAMERA v1
// Prise de photo directe — extrait de js/app.js lignes 1060-1251
// Dépendances globales : _saveDocRecord, renderDocList, _docCurrentFolder, renderDocumentation (documentation.js), showView (router.js)

var _cameraStream = null;
var _cameraFacing = 'environment'; // arrière par défaut
var _capturedDataUrl = null;

var _cameraContext = null; // 'doc-form' ou null (dashboard)
function openCameraModal(context) {
  _cameraContext = context || null;
  _capturedDataUrl = null;
  document.getElementById('camera-preview-result').style.display = 'none';
  document.getElementById('camera-capture-btn').style.display = 'inline-flex';
  document.getElementById('camera-save-btn').style.display = 'none';
  document.getElementById('camera-retake-btn').style.display = 'none';
  document.getElementById('camera-status').textContent = '';
  document.getElementById('camera-modal').style.display = 'flex';

  // Essayer d'ouvrir la caméra via getUserMedia
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    _startCamera();
  } else {
    // Fallback mobile — input capture
    document.getElementById('camera-video').style.display = 'none';
    document.getElementById('camera-capture-btn').style.display = 'none';
    document.getElementById('camera-switch-btn').style.display = 'none';
    document.getElementById('camera-status').textContent = 'Appuyez sur le bouton pour ouvrir la caméra';
    var mobileBtn = document.createElement('button');
    mobileBtn.className = 'btn btn-gold';
    mobileBtn.textContent = '📷 Ouvrir la caméra';
    mobileBtn.onclick = function(){ document.getElementById('camera-mobile-input').click(); };
    document.getElementById('camera-status').appendChild(mobileBtn);
  }
}

function _startCamera() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(function(t){ t.stop(); });
  }
  var constraints = { video: { facingMode: _cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } } };
  navigator.mediaDevices.getUserMedia(constraints)
    .then(function(stream) {
      _cameraStream = stream;
      var video = document.getElementById('camera-video');
      video.style.display = 'block';
      video.srcObject = stream;
      // Afficher bouton retourner si mobile (plusieurs caméras)
      if (navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(function(devices){
          var cams = devices.filter(function(d){ return d.kind === 'videoinput'; });
          document.getElementById('camera-switch-btn').style.display = cams.length > 1 ? 'inline-flex' : 'none';
        });
      }
      document.getElementById('camera-status').textContent = '';
    })
    .catch(function(err) {
      // getUserMedia échoué → fallback input file
      document.getElementById('camera-video').style.display = 'none';
      document.getElementById('camera-capture-btn').style.display = 'none';
      document.getElementById('camera-status').textContent = 'Caméra non disponible. ';
      var btn = document.createElement('button');
      btn.className = 'btn btn-gold';
      btn.textContent = '📷 Choisir une photo';
      btn.onclick = function(){ document.getElementById('camera-mobile-input').click(); };
      document.getElementById('camera-status').parentNode.appendChild(btn);
    });
}

function switchCamera() {
  _cameraFacing = _cameraFacing === 'environment' ? 'user' : 'environment';
  _startCamera();
}

function capturePhoto() {
  var video  = document.getElementById('camera-video');
  var canvas = document.getElementById('camera-canvas');
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  _capturedDataUrl = canvas.toDataURL('image/jpeg', 0.9);

  // Afficher le résultat
  document.getElementById('camera-result-img').src = _capturedDataUrl;
  document.getElementById('camera-preview-result').style.display = 'block';
  document.getElementById('camera-video').style.display = 'none';
  document.getElementById('camera-capture-btn').style.display = 'none';
  document.getElementById('camera-save-btn').style.display = 'inline-flex';
  document.getElementById('camera-retake-btn').style.display = 'inline-flex';
  document.getElementById('camera-switch-btn').style.display = 'none';
}

function retakePhoto() {
  _capturedDataUrl = null;
  document.getElementById('camera-preview-result').style.display = 'none';
  document.getElementById('camera-video').style.display = 'block';
  document.getElementById('camera-capture-btn').style.display = 'inline-flex';
  document.getElementById('camera-save-btn').style.display = 'none';
  document.getElementById('camera-retake-btn').style.display = 'none';
}

function cameraMobileCapture(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    _capturedDataUrl = e.target.result;
    document.getElementById('camera-result-img').src = _capturedDataUrl;
    document.getElementById('camera-preview-result').style.display = 'block';
    document.getElementById('camera-save-btn').style.display = 'inline-flex';
    document.getElementById('camera-retake-btn').style.display = 'inline-flex';
  };
  reader.readAsDataURL(file);
}

function saveCapturedPhoto() {
  if (!_capturedDataUrl) return;

  // ── Contexte doc-form : injecter la photo dans le formulaire doc ──
  if (_cameraContext === 'doc-form') {
    var prev = document.getElementById('doc-photo-preview');
    if (prev) {
      prev.innerHTML = '<img alt="Photo capturée" src="'+_capturedDataUrl+'" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid #333;margin-top:4px;">';
      prev.dataset.photoData = _capturedDataUrl;
      prev.dataset.photoType = 'image';
    }
    closeCameraModal();
    // Remettre le z-index du doc-modal au premier plan
    var docModal = document.getElementById('doc-modal');
    if (docModal) { docModal.style.zIndex = '10000'; docModal.style.display = 'flex'; }
    return;
  }

  // ── Contexte dashboard (comportement original) ────────────────────
  var now = new Date();
  var pad = function(n){ return String(n).padStart(2,'0'); };
  var name = 'Photo ' + now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) +
             ' ' + pad(now.getHours()) + 'h' + pad(now.getMinutes()) + 'm' + pad(now.getSeconds()) + 's';

  var id = 'doc_photo_' + Date.now();
  var btn = document.getElementById('camera-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement...'; }

  // Essai upload serveur
  fetch('/upload.php', {
    method: 'POST',
    body: (function(){
      var fd = new FormData();
      // Convertir dataUrl en Blob
      var arr = _capturedDataUrl.split(',');
      var mime = arr[0].match(/:(.*?);/)[1];
      var bstr = atob(arr[1]);
      var u8arr = new Uint8Array(bstr.length);
      for (var i=0; i<bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
      var blob = new Blob([u8arr], { type: mime });
      fd.append('file', blob, id + '.jpg');
      fd.append('cat', 'nouveau');
      fd.append('doc_id', id);
      return fd;
    })()
  })
  .then(function(r){ return r.json(); })
  .then(function(res){
    var url = res.ok ? res.url : _capturedDataUrl;
    _saveDocRecord(id, 'nouveau', name, url, 'image', '');
    closeCameraModal();
    if (typeof renderDocumentation === 'function') {
      _docCurrentFolder = 'nouveau';
      renderDocList('nouveau');
      showView('documentation');
    }
  })
  .catch(function(){
    _saveDocRecord(id, 'nouveau', name, _capturedDataUrl, 'image', '');
    closeCameraModal();
    if (typeof renderDocumentation === 'function') {
      _docCurrentFolder = 'nouveau';
      renderDocList('nouveau');
      showView('documentation');
    }
  });
}

function closeCameraModal() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(function(t){ t.stop(); });
    _cameraStream = null;
  }
  var video = document.getElementById('camera-video');
  if (video) video.srcObject = null;
  document.getElementById('camera-modal').style.display = 'none';
}
