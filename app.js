const measurements = [
  ['height','Height','core',66], ['shoulder','Shoulder','core',16.5], ['chest','Chest / bust','core',36], ['waist','Waist','core',30], ['hip','Hip','core',39],
  ['neck','Neck circumference','upper',14.5], ['armhole','Armhole','upper',17], ['bicep','Bicep','upper',12], ['elbow','Elbow','upper',10.5], ['wrist','Wrist','upper',6.5], ['sleeve','Sleeve length','upper',23],
  ['inseam','Inseam','lower',29], ['outseam','Outseam','lower',40], ['thigh','Thigh','lower',22], ['knee','Knee','lower',15], ['calf','Calf','lower',14.5], ['ankle','Ankle','lower',9]
];
const state = { values: Object.fromEntries(measurements.map(([key,, ,value]) => [key, value])), captures: {}, skippedCapture: {}, stream: null, activeGroup: 'core' };
const $ = (selector) => document.querySelector(selector);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  $('#restartButton').hidden = id === 'home';
  if (id === 'review') renderMeasurements();
  if (id === 'summary') renderSummary();
  stopCamera(); window.scrollTo({top: 0, behavior: 'smooth'});
}
function stopCamera() { if (state.stream) { state.stream.getTracks().forEach(track => track.stop()); state.stream = null; } }
async function openCamera(view) {
  const video = $(`#${view}Video`), message = $(`#${view}Message`), preview = $(`#${view}Preview`);
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: false});
    video.srcObject = state.stream; preview.hidden = true; message.hidden = true;
    $(`#${view}Capture`).textContent = 'Capture photo';
  } catch (error) {
    state.skippedCapture[view] = true;
    message.textContent = 'Camera access is unavailable. You can continue and enter measurements manually.';
    toast('Camera unavailable — manual review is ready.');
    $(`#${view}Capture`).textContent = view === 'front' ? 'Continue to side view' : 'Continue to measurements';
  }
}
function capture(view) {
  const video = $(`#${view}Video`), preview = $(`#${view}Preview`), canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 960;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  state.captures[view] = canvas.toDataURL('image/jpeg', .82); preview.src = state.captures[view]; preview.hidden = false;
  stopCamera(); $(`#${view}Capture`).textContent = view === 'front' ? 'Continue to side view' : 'Continue to measurements';
  if (view === 'front') $('#frontRetake').hidden = false;
}
function handleCapture(view) { state.stream ? capture(view) : ((state.captures[view] || state.skippedCapture[view]) ? showScreen(view === 'front' ? 'side' : 'review') : openCamera(view)); }
function renderMeasurements() {
  const list = $('#measurementForm'); list.innerHTML = measurements.filter(([, ,group]) => group === state.activeGroup).map(([key, label]) => `<div class="measure-row"><label for="${key}">${label}</label><div class="measure-input"><input id="${key}" type="number" min="0" max="120" step="0.1" value="${state.values[key]}" inputmode="decimal" aria-label="${label} in inches"><span>in</span></div></div>`).join('');
  list.querySelectorAll('input').forEach(input => input.addEventListener('input', () => { if (input.value !== '') state.values[input.id] = Number(input.value); }));
}
function renderSummary() { $('#summaryList').innerHTML = measurements.map(([key, label]) => `<div class="summary-row"><span>${label}</span><strong>${Number(state.values[key]).toFixed(1)} in</strong></div>`).join(''); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); }

document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.go)));
$('#restartButton').addEventListener('click', () => showScreen('home'));
$('#frontCapture').addEventListener('click', () => handleCapture('front'));
$('#sideCapture').addEventListener('click', () => handleCapture('side'));
$('#frontRetake').addEventListener('click', () => { state.captures.front = null; state.skippedCapture.front = false; openCamera('front'); });
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { state.activeGroup = tab.dataset.group; document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab)); renderMeasurements(); }));
$('#summaryButton').addEventListener('click', () => showScreen('summary'));
$('#saveButton').addEventListener('click', () => { const profiles = JSON.parse(localStorage.getItem('tailorScanProfiles') || '[]'); const name = $('#profileName').value.trim() || 'Unnamed client'; profiles.unshift({id: Date.now(), name, values: state.values, savedAt: new Date().toISOString()}); localStorage.setItem('tailorScanProfiles', JSON.stringify(profiles)); toast(`${name}'s profile saved on this device.`); });
