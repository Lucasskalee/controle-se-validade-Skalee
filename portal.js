(() => {
  const config = window.SKALEE_DOWNLOAD_CONFIG?.current || {};
  const button = document.querySelector("#download-button");
  const note = document.querySelector("#download-note");
  const warning = document.querySelector("#release-warning");
  const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2).replace(".", ",")} MB`;
  const formatDate = (value) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));

  document.querySelector("#release-date").textContent = `Publicado em ${formatDate(config.date)}`;
  document.querySelector("#file-name").textContent = config.fileName || "Não informado";
  document.querySelector("#file-size").textContent = config.sizeBytes ? formatBytes(config.sizeBytes) : "Não informado";
  document.querySelector("#file-hash").textContent = config.sha256 || "Não informado";
  document.querySelector("#year").textContent = new Date().getFullYear();

  if (config.downloadUrl) {
    button.href = config.downloadUrl;
    button.setAttribute("download", "");
    note.textContent = "Download oficial configurado";
  } else {
    button.href = "#download";
    button.setAttribute("aria-disabled", "true");
    button.addEventListener("click", (event) => event.preventDefault());
    warning.hidden = false;
    warning.textContent = "O APK está pronto para distribuição, mas o link público ainda não foi configurado. Isso evita publicar um arquivo sem autorização. Edite apenas download-config.js quando houver uma URL real de GitHub Release ou outro armazenamento aprovado.";
  }
})();
