(function (root) {
 'use strict';
 function uniqueImages(images) {
  const paths = new Set(), urls = new Set();
  return images.filter(image => {
   if (!image) return false;
   const url = String(image.photoUrl || '').trim();
   const path = String(image.photoPath || '').trim();
   if (!/^(https?:\/\/|blob:|data:image\/|\/(?!\/))/i.test(url)) return false;
   if ((path && paths.has(path)) || urls.has(url)) return false;
   if (path) paths.add(path);
   urls.add(url);
   return true;
  });
 }
 let currentDialog = null;
 function close() { currentDialog?.close(); }
 function open(product, photo) {
  close();
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'product-gallery';
  dialog.setAttribute('aria-labelledby', 'productGalleryTitle');
  dialog.innerHTML = `<div class="gallery-shell">
   <div class="gallery-header"><div><h2 id="productGalleryTitle">Fotos do produto</h2><p class="gallery-product-name"></p></div><button class="gallery-close" type="button" aria-label="Fechar galeria">✕</button></div>
   <div class="gallery-track" tabindex="0" role="region" aria-label="Fotos; deslize ou use as setas" aria-roledescription="carrossel"></div>
   <div class="gallery-controls"><button class="gallery-prev" type="button" aria-label="Foto anterior">‹</button><span class="gallery-counter" aria-live="polite"></span><button class="gallery-next" type="button" aria-label="Próxima foto">›</button></div>
   <p class="gallery-status" role="status"></p>
  </div>`;
  dialog.querySelector('.gallery-product-name').textContent = `${product.name || 'Produto'}${product.code ? ` · Int: ${product.code}` : ''}`;
  const track = dialog.querySelector('.gallery-track');
  const status = dialog.querySelector('.gallery-status');
  const prev = dialog.querySelector('.gallery-prev'), next = dialog.querySelector('.gallery-next');
  const counter = dialog.querySelector('.gallery-counter');
  let images = uniqueImages([{ photoUrl: photo || product.photo, photoPath: product.photoPath }]);
  let active = 0, drag = null, frame = null;
  const controls = () => {
   counter.textContent = images.length ? `${active + 1} de ${images.length}` : 'Sem fotos';
   prev.disabled = active === 0;
   next.disabled = active >= images.length - 1;
  };
  const go = index => {
   active = Math.max(0, Math.min(images.length - 1, index));
   track.scrollTo({ left: active * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
   controls();
  };
  const render = () => {
   const oldLength = track.querySelectorAll('.gallery-slide').length;
   track.querySelector('.gallery-empty')?.remove();
   images.slice(oldLength).forEach((image, i) => {
    const slide = document.createElement('div');
    slide.className = 'gallery-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-label', `Foto ${i + 1}`);
    const img = document.createElement('img');
    img.alt = `${product.name || 'Produto'} — foto ${i + 1}`;
    img.draggable = false; img.decoding = 'async'; img.loading = i === 0 ? 'eager' : 'lazy';
    img.addEventListener('error', () => {
     img.remove();
     const message = document.createElement('p'); message.className = 'gallery-empty';
     message.textContent = 'Não foi possível carregar esta foto.'; slide.append(message);
    }, { once: true });
    img.src = image.photoUrl; slide.append(img); track.append(slide);
   });
   if (!images.length) {
    const empty = document.createElement('p'); empty.className = 'gallery-empty';
    empty.textContent = 'Nenhuma foto disponível para este produto.'; track.append(empty);
   }
   controls();
  };
  document.body.append(dialog);
  currentDialog = dialog;
  dialog.showModal();
  dialog.querySelector('.gallery-close').focus();
  const savedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const captureEscape = e => {
   if (dialog.open && e.key === 'Escape') {
    e.preventDefault(); e.stopImmediatePropagation(); dialog.close();
   }
  };
  window.addEventListener('keydown', captureEscape, true);
  dialog.addEventListener('close', () => {
   const wasCurrent = currentDialog === dialog;
   if (wasCurrent) { currentDialog = null; document.body.style.overflow = savedOverflow; }
   window.removeEventListener('keydown', captureEscape, true);
   resize.disconnect();
   if (frame !== null) cancelAnimationFrame(frame);
   dialog.remove();
   if (wasCurrent && previousFocus?.isConnected) previousFocus.focus();
  }, { once: true });
  dialog.querySelector('.gallery-close').addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  dialog.addEventListener('keydown', e => {
   // Native dialog traps focus and closes on Escape. Do not close the underlying modal.
   e.stopPropagation();
   if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); go(active + (e.key === 'ArrowLeft' ? -1 : 1)); }
  });
  prev.addEventListener('click', () => go(active - 1)); next.addEventListener('click', () => go(active + 1));
  track.addEventListener('scroll', () => {
   if (frame !== null) return;
   frame = requestAnimationFrame(() => {
    frame = null; active = Math.max(0, Math.min(images.length - 1, Math.round(track.scrollLeft / (track.clientWidth || 1)))); controls();
   });
  }, { passive: true });
  track.addEventListener('pointerdown', e => {
   if (e.pointerType !== 'mouse' || e.button !== 0) return;
   drag = { x: e.clientX, left: track.scrollLeft }; track.setPointerCapture(e.pointerId); track.classList.add('dragging');
  });
  track.addEventListener('pointermove', e => { if (drag) track.scrollLeft = drag.left + drag.x - e.clientX; });
  const endDrag = () => {
   if (!drag) return; drag = null; track.classList.remove('dragging'); go(Math.round(track.scrollLeft / (track.clientWidth || 1)));
  };
  track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag);
  const resize = new ResizeObserver(() => { track.scrollLeft = active * track.clientWidth; });
  resize.observe(track);
  render(); status.textContent = 'Buscando outras fotos deste código...';
  void (async () => {
   try {
    const result = await root.skaleeDb?.loadProductGallery?.(product);
    if (!dialog.open) return;
    const loaded = [...(result?.images || [])];
    if (product.photoPath) loaded.sort((a, b) => Number(b.photoPath === product.photoPath) - Number(a.photoPath === product.photoPath));
    images = uniqueImages([...images, ...loaded]);
    render();
    status.textContent = result?.partial ? 'Algumas fotos não puderam ser consultadas. Exibindo as disponíveis.' : images.length > 1 ? 'Deslize para ver as fotos deste produto.' : images.length === 1 ? 'Esta é a única foto disponível para este produto.' : 'Nenhuma foto cadastrada para este código.';
   } catch (error) {
    if (dialog.open) status.textContent = 'Não foi possível buscar outras fotos. A foto atual foi mantida.';
    console.warn('Falha ao consultar galeria:', error);
   }
  })();
 }
 root.SkaleeProductGallery = { open, close, uniqueImages };
 if (typeof module !== 'undefined') module.exports = root.SkaleeProductGallery;
})(typeof window === 'undefined' ? globalThis : window);
