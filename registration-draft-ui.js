/* Uses the existing registration form; loaded after its classic script. */
(() => {
 const storage = SkaleeDraftStore.createStore(indexedDB);
 const status = document.getElementById('draftStatus');
 let user = '', store = '', generation = 0, suspended = false, checkpoint = null;
 let chain = Promise.resolve(), transition = Promise.resolve();
 let cameraRequestId = null, cameraResultId = null;
 const fields = ['barcode', 'qty', 'expiry', 'supplierCode', 'supplierName', 'imageUrlInput'];
 function notifyDraftChanged() {
  window.dispatchEvent(new CustomEvent('skalee:draft-changed', {
   detail: { userId: user, storeId: store, pending: checkpoint?.state || null }
  }));
 }
 function report(message) {
  status.textContent = message;
  document.getElementById('draftReview').hidden = checkpoint?.state !== 'sending';
  // A pending result refers to this exact payload; keep it immutable until resolved.
  document.querySelectorAll('#register input, #register button:not(#save):not(#clear):not(#draftReview):not(#draftPending)').forEach(element => {
   element.disabled = Boolean(checkpoint);
  });
  notifyDraftChanged();
 }
 const pendingKey = (location, id) => JSON.stringify(['pending', location, id]);
 async function refreshPending() {
  const owner = user, location = store;
  const drafts = owner ? await storage.list(owner) : [];
  if (owner !== user || location !== store) return;
  const count = drafts.filter(draft => draft.originalStoreId === location).length;
  const button = document.getElementById('draftPending');
  button.hidden = !count;
  button.textContent = `Cadastros pendentes nesta loja (${count})`;
  notifyDraftChanged();
 }
 function snapshot() {
  return {
   fields: Object.fromEntries(fields.map(id => [id, els[id].value])),
   selected, photoFile: photoData ? null : photoFile, photoData: photoData ? { ...photoData, previewUrl: undefined } : null,
   image: selectedImageState ? { ...selectedImageState, photoData: undefined } : null,
   checkpoint, cameraRequestId, cameraResultId
  };
 }
 function hasActiveCameraTicket(requestId) {
  if (!requestId) return false;
  try {
   const raw = localStorage.getItem('skalee.camera.pending.v1');
   if (!raw) return false;
   const ticket = JSON.parse(raw);
   return Boolean(ticket && (!ticket.id || ticket.id === requestId));
  } catch (_) {
   return false;
  }
 }
 function hasContent(value) {
  if (!value || typeof value !== 'object') return false;
  const hasSelected = Boolean(value.selected && (value.selected.name || value.selected.barcode || value.selected.code || value.selected.catalogProductId));
  const hasPhoto = Boolean(value.photoFile || value.photoData?.blob || value.photoData || value.cameraResultId || hasActiveCameraTicket(value.cameraRequestId));
  const hasFields = Boolean(value.fields && Object.values(value.fields).some(v => String(v ?? '').trim().length > 0));
  const hasCheckpoint = Boolean(value.checkpoint || value.originalStoreId);
  return hasSelected || hasPhoto || hasFields || hasCheckpoint;
 }
 function enqueue(action) {
  const task = chain.catch(() => {}).then(action);
  chain = task;
  return task;
 }
 function persist() {
  if (!user || suspended) return Promise.resolve();
  const owner = user, location = store, value = structuredClone(snapshot());
  if (!hasContent(value)) {
   return enqueue(async () => {
    const existing = await storage.read(owner, location);
    if (existing && !existing.checkpoint && !existing.originalStoreId && !hasActiveCameraTicket(existing.cameraRequestId)) {
     await storage.remove(owner, location);
    }
   }).then(() => notifyDraftChanged());
  }
  return enqueue(() => storage.write(owner, location, value)).then(() => notifyDraftChanged());
 }
 function autosave() { void persist().catch(() => report('Não foi possível proteger o rascunho neste dispositivo. Verifique o espaço disponível.')); }
 async function restore(owner, location, token) {
  const draft = await storage.read(owner, location);
  if (token !== generation || owner !== user || location !== store) return;
  if (draft && hasContent(draft)) {
   suspended = true;
   resetForm();
   fields.forEach(id => { els[id].value = draft.fields?.[id] || ''; });
   selected = draft.selected || null;
   photoFile = draft.photoFile || null;
   photoData = draft.photoData || null;
   checkpoint = draft.checkpoint || null;
   cameraRequestId = draft.cameraRequestId || null;
   cameraResultId = draft.cameraResultId || null;
   selectedImageState = draft.image || null;
   if (photoData?.blob) {
    photoPreviewUrl = URL.createObjectURL(photoData.blob);
    photoData.previewUrl = photoPreviewUrl;
    selectedImageState = { type: 'processed', photoData, source: draft.image?.source || 'upload' };
    const image = document.createElement('img'); image.src = photoPreviewUrl;
    els.preview.replaceChildren(image);
   }
   if (selected) { els.found.textContent = selected.name; els.found.classList.add('show'); }
   suspended = false;
   if (!photoData && photoFile) {
    let recovered;
    try { recovered = await processPhoto(photoFile); }
    catch (error) { report('Os campos foram recuperados, mas a foto precisa ser substituída: ' + error.message); return; }
    if (token !== generation) { URL.revokeObjectURL(recovered.previewUrl); return; }
    photoData = recovered;
    selectedImageState = { type: 'processed', photoData, source: 'upload' };
    photoPreviewUrl = recovered.previewUrl;
    const image = document.createElement('img'); image.src = photoPreviewUrl; els.preview.replaceChildren(image);
   }
   report(checkpoint ? 'Cadastro interrompido ou pendente. Clique em Salvar para verificar a recuperação antes de continuar.' : 'Rascunho recuperado neste dispositivo.');
   void updateRegisterStockInfo();
  } else {
   if (draft && !draft.checkpoint && !draft.originalStoreId && !hasActiveCameraTicket(draft.cameraRequestId)) {
    await enqueue(() => storage.remove(owner, location));
   }
   report('Os campos e a foto serão protegidos neste dispositivo.');
  }
  await refreshPending();
 }
 async function switchStore() {
  if (!user || store === els.store.value) return;
  const owner = user, startToken = generation;
  const previous = snapshot(), previousStore = store, location = els.store.value;
  await persist();
  if (startToken !== generation || owner !== user) return;
  const token = ++generation;
  store = location;
  const existing = await storage.read(owner, location);
  if (token !== generation) return;
  // First selection moves an unassigned draft; switching stores keeps each draft separate.
  if (!previousStore && !existing && hasContent(previous)) {
   await storage.write(owner, location, previous);
   await storage.remove(owner, previousStore);
  } else {
   suspended = true; resetForm(); checkpoint = null; cameraRequestId = cameraResultId = null; suspended = false;
  }
  await restore(owner, location, token);
 }
 function changeStore() {
  transition = transition.catch(() => {}).then(switchStore);
  return transition;
 }
 window.addEventListener('skalee:authenticated', event => {
  const next = event.detail?.userId;
  if (!next || next === user) return;
  autosave();
  user = next; store = ''; checkpoint = null; ++generation;
  cameraRequestId = cameraResultId = null;
  suspended = true; resetForm(); suspended = false;
  const token = generation;
  const owner = user;
  transition = chain.catch(() => {}).then(() => restore(owner, '', token)).then(switchStore);
  void transition.catch(error => report(error.message));
 });
 window.addEventListener('skalee:signed-out', () => {
  autosave(); user = ''; store = ''; checkpoint = null; ++generation;
  cameraRequestId = cameraResultId = null;
  suspended = true; resetForm(); suspended = false; report('');
 });
 document.getElementById('register').addEventListener('input', autosave);
 document.getElementById('register').addEventListener('change', event => {
  if (event.target === els.store) void changeStore().catch(error => report(error.message));
  else autosave();
 });
 new MutationObserver(() => { if (user) void changeStore().catch(error => report(error.message)); }).observe(els.store, { childList: true });
 new MutationObserver(autosave).observe(document.getElementById('productImageSection'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'src'] });
 new MutationObserver(autosave).observe(els.found, { childList: true, subtree: true });
 window.addEventListener('pagehide', autosave);
 document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
 // Capture the raw File before asynchronous compression or a process interruption.
 els.photo.addEventListener('change', event => {
  if (!event.target.files[0]) return;
  photoFile = event.target.files[0]; photoData = null; selectedImageState = null; autosave();
 }, true);
 document.getElementById('draftReview').addEventListener('click', async () => {
  if (checkpoint?.state !== 'sending') return;
  if (!confirm('Confira a lista de produtos e a fila de sincronização. Você confirmou que este cadastro NÃO foi criado nem está na fila? Liberar sem conferir pode duplicar o produto.')) return;
  try {
   if (checkpoint.queueId) await window.skaleeLocalStore.removeSyncQueueItem(checkpoint.queueId);
   checkpoint = null;
   await persist(); report('Rascunho preservado e liberado para nova tentativa após sua conferência.');
  }
  catch (error) { report(error.message); }
 });
 document.getElementById('draftPending').addEventListener('click', async () => {
  try {
   if (hasContent(snapshot())) return report('Conclua ou limpe o formulário atual antes de recuperar outra pendência.');
   const owner = user, location = store, token = generation;
   const drafts = (await storage.list(owner)).filter(draft => draft.originalStoreId === location);
   const recoverable = drafts.find(draft => draft.checkpoint?.state !== 'queued');
   if (!recoverable) return report('Os cadastros estão na fila offline. Serão enviados quando a conexão voltar.');
   if (token !== generation) return;
   const oldKey = recoverable.storeId;
   delete recoverable.originalStoreId;
   await enqueue(async () => { await storage.write(owner, location, recoverable); await storage.remove(owner, oldKey); });
   await restore(owner, location, token);
  } catch (error) { report(error.message); }
 });
 els.clear.addEventListener('click', event => {
  event.preventDefault(); event.stopImmediatePropagation();
  if (!confirm('Descartar os campos deste formulário? Cadastros pendentes serão preservados para recuperação.')) return;
  if (checkpoint) { report('Finalize ou confira o cadastro pendente antes de limpar este rascunho.'); return; }
  const owner = user, location = store;
  cameraRequestId = cameraResultId = null;
  suspended = true; resetForm(); suspended = false;
  report('Os campos e a foto serão protegidos neste dispositivo.');
  if (owner) {
   void enqueue(() => storage.remove(owner, location))
    .then(() => refreshPending())
    .then(() => notifyDraftChanged())
    .catch(error => report(error.message));
  } else {
   notifyDraftChanged();
  }
 }, true);
 window.skaleeRegistrationDraft = {
  persist,
  async begin() {
   await transition;
   if (!user) throw new Error('Entre novamente antes de salvar.');
   if (store !== els.store.value) await changeStore();
   const context = { owner: user, location: store, token: generation, draft: structuredClone(snapshot()) };
   if (checkpoint) {
    if (checkpoint.id && checkpoint.state === 'photo-pending') return { retryId: checkpoint.id, context };
    throw new Error('Este cadastro tem envio pendente ou resultado incerto. Confira os produtos e a sincronização antes de repetir. O rascunho foi preservado.');
   }
   checkpoint = { state: 'sending' };
   context.draft.checkpoint = checkpoint;
   try { await persist(); } catch (error) { checkpoint = null; throw error; }
   report('Envio em andamento. Se for interrompido, confira o resultado antes de tentar novamente.');
   return { context };
  },
  async created(id, context, state = 'photo-pending') {
   context.draft.checkpoint = { state, id };
   await enqueue(() => storage.write(context.owner, context.location, context.draft));
   if (context.token === generation) { checkpoint = context.draft.checkpoint; report('Cadastro em processamento; rascunho preservado.'); }
  },
  async finish(result, context) {
   const current = context.token === generation && context.owner === user;
   if (result.isOffline) {
    context.draft.checkpoint = { state: 'queued', id: result.id };
    await enqueue(async () => {
     await storage.write(context.owner, pendingKey(context.location, result.id), { ...context.draft, originalStoreId: context.location });
     await storage.remove(context.owner, context.location);
    });
    if (current) {
     checkpoint = null; suspended = true; resetForm(); suspended = false;
     report('Cadastro na fila offline; cópia preservada. Você já pode cadastrar outro produto.');
     await refreshPending();
    }
    return true;
   }
   if (result.photoUploadError) {
    await this.created(result.id, context, 'photo-pending');
    if (current) report('Produto salvo. Foto preservada: clique em Salvar para tentar apenas o envio da imagem.');
    return false;
   }
   const owner = context.owner, location = context.location;
   await enqueue(() => storage.remove(owner, location));
   if (!current) {
    notifyDraftChanged();
    return true;
   }
   checkpoint = null;
   cameraRequestId = cameraResultId = null;
   suspended = true; resetForm(); suspended = false;
   report('Cadastro concluído; rascunho removido.');
   await refreshPending();
   return true;
  },
  async synced(temporaryId, result, owner) {
   if (!owner) return;
   // The queue records the original scope; never inspect another user's draft.
   const location = result.draftStoreId;
   let key = location, draft = await storage.read(owner, key);
   if (draft?.checkpoint?.id !== temporaryId) { key = pendingKey(location, temporaryId); draft = await storage.read(owner, key); }
   if (draft?.checkpoint?.id !== temporaryId) return;
   if (result.photoUploadError) {
    draft.checkpoint = { state: 'photo-pending', id: result.id };
    await storage.write(owner, key, draft);
   } else await storage.remove(owner, key);
   if (owner === user && location === store && key === location) {
    if (result.photoUploadError) checkpoint = draft.checkpoint;
    else { checkpoint = null; cameraRequestId = cameraResultId = null; suspended = true; resetForm(); suspended = false; }
    report(result.photoUploadError || 'Cadastro sincronizado; rascunho removido.');
   }
   await refreshPending();
  },
  async syncUncertain(item) {
   const owner = item.payload.draftUserId, location = item.payload.draftStoreId;
   if (!owner) return;
   let key = location, draft = await storage.read(owner, key);
   if (draft?.checkpoint?.id !== item.payload.temporaryId) { key = pendingKey(location, item.payload.temporaryId); draft = await storage.read(owner, key); }
   if (!draft) return;
   draft.checkpoint = { state: 'sending', queueId: item.id };
   await storage.write(owner, key, draft);
   if (owner === user && location === store && key === location) { checkpoint = draft.checkpoint; report('Envio interrompido: confira o resultado antes de repetir.'); }
   await refreshPending();
  },
  scope: () => ({ userId: user, storeId: store }),
  ready: () => transition,
  hasContent,
  async prepareCamera() {
   await transition;
   if (!user) throw new Error('Entre na sua conta antes de fotografar.');
   if (checkpoint) throw new Error('Finalize o cadastro pendente antes de trocar a foto.');
   if (store !== els.store.value) await changeStore();
   const ticket = { id: crypto.randomUUID(), userId: user, storeId: store };
   if (!store) throw new Error('Selecione a loja antes de abrir a câmera.');
   cameraRequestId = ticket.id; cameraResultId = null;
   const draft = structuredClone(snapshot());
   draft.cameraRequestId = ticket.id;
   await enqueue(() => storage.write(ticket.userId, ticket.storeId, draft));
   return ticket;
  },
  async receiveNativePhoto(ticket) {
   await transition;
   if (ticket.userId !== user || ticket.storeId !== store) return false;
   await restore(user, store, generation);
   await persist();
   return true;
  },
  pending: () => checkpoint?.state,
  token: () => generation
 };
})();
