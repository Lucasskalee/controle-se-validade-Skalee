/* Native Android registration camera. Browsers keep their file input.
 * Save the capture owner before leaving the WebView, persist the raw File on return,
 * then let the draft controller restore it through the existing processPhoto pipeline. */
(function (root) {
 'use strict';
 function plugins() { return root.skaleeNativePlugins || root.Capacitor?.Plugins || {}; }
 function isNative() { return Boolean(root.Capacitor?.isNativePlatform?.()); }
 const PENDING_KEY = 'skalee.camera.pending.v1';
 let busy = false, installed = false, handling = Promise.resolve();
 function pendingTicket() { return JSON.parse(root.localStorage.getItem(PENDING_KEY) || 'null'); }
 function clearTicket(ticket) {
  if (pendingTicket()?.id === ticket.id) root.localStorage.removeItem(PENDING_KEY);
 }
 async function toFile(photo) {
  const url = photo.webPath || (photo.path && root.Capacitor.convertFileSrc(photo.path));
  if (!url) throw new Error('A câmera não retornou a foto.');
  const response = await fetch(url);
  if (!response.ok) throw new Error('Não foi possível ler a foto capturada.');
  const blob = await response.blob();
  const type = blob.type || 'image/jpeg';
  return new File([blob], 'camera-' + Date.now() + '.' + (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'), { type });
 }
 function isCancel(error) {
  return /cancel/i.test(String(error?.message || error || ''));
 }
 async function preserveResult(ticket, photo) {
  // Persist the URI before reading it, then the raw File before decoding/compressing.
  root.localStorage.setItem(PENDING_KEY, JSON.stringify({ ...ticket, photo }));
  const storage = root.SkaleeDraftStore.createStore(root.indexedDB);
  const draft = await storage.read(ticket.userId, ticket.storeId);
  if (!draft || draft.cameraRequestId !== ticket.id) throw new Error('O rascunho de origem da câmera não está disponível.');
  if (draft.cameraResultId !== ticket.id) {
   const file = await toFile(photo);
   await storage.write(ticket.userId, ticket.storeId, {
    ...draft, photoFile: file, photoData: null, image: null, cameraResultId: ticket.id
   });
  }
  clearTicket(ticket);
  // A different logged-in user or store must never receive this image.
  await root.skaleeRegistrationDraft?.receiveNativePhoto(ticket);
 }
 async function capture() {
  if (busy) return;
  busy = true;
  let ticket;
  try {
   ticket = await root.skaleeRegistrationDraft.prepareCamera();
   root.localStorage.setItem(PENDING_KEY, JSON.stringify(ticket));
   const photo = await plugins().Camera.getPhoto({ source: 'CAMERA', resultType: 'uri', quality: 90, width: 1600, height: 1600, correctOrientation: true, saveToGallery: false });
   await preserveResult(ticket, photo);
  } catch (error) {
   if (isCancel(error)) { if (ticket) clearTicket(ticket); return; }
   console.error('[CAMERA] falha na câmera nativa', error);
   const denied = /denied|permission/i.test(String(error?.message || error));
   root.alert(denied ? 'Permissão de câmera negada. Autorize a câmera nas configurações do Android para fotografar produtos.'
    : 'Não foi possível concluir a foto. ' + (error.message || 'Tente novamente.'));
  } finally { busy = false; }
 }
 function install(input) {
  if (installed || !isNative() || !plugins().Camera || !input) return;
  installed = true;
  // Capture phase: replace the WebView file chooser, which is the path Android kills.
  input.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); void capture(); }, true);
  // Android may destroy the process while the camera is open; Capacitor replays the result here.
  const restored = async event => {
   if (event?.pluginId !== 'Camera' || event.methodName !== 'getPhoto') return;
   if (event.success === false || !event.data) {
    const ticket = pendingTicket();
    if (ticket && isCancel(event.error?.message)) clearTicket(ticket);
    if (event.error && !isCancel(event.error.message)) console.warn('[CAMERA] resultado restaurado com erro', event.error);
    return;
   }
   try {
    const ticket = pendingTicket();
    if (!ticket) return; // already consumed, or not a Skalee registration capture
    await preserveResult(ticket, event.data);
   }
   catch (error) { console.error('[CAMERA] falha ao recuperar foto', error); root.alert('Não foi possível recuperar a foto: ' + error.message); }
  };
  void plugins().App?.addListener?.('appRestoredResult', event => {
   handling = handling.catch(() => {}).then(() => restored(event));
   return handling;
  });
  void plugins().App?.addListener?.('appStateChange', state => {
   if (!state.isActive) {
    void root.skaleeRegistrationDraft?.persist().catch(error => console.error('[DRAFT]', error));
    root.dispatchEvent?.(new Event('skalee:native-background'));
   }
  });
  // If the process also died while reading the restored URI, retry that durable ticket.
  const ticket = pendingTicket();
  if (ticket?.photo) handling = handling.then(() => restored({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: ticket.photo }));
 }
 root.SkaleeNativeCamera = { install, isNative, toFile };
 if (typeof document !== 'undefined') {
  const start = () => install(document.getElementById('photo'));
  start(); // Loaded after the form and draft controller, before auth hydration.
 }
 if (typeof module !== 'undefined') module.exports = root.SkaleeNativeCamera;
})(typeof window === 'undefined' ? globalThis : window);
